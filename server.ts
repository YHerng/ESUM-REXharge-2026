import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as XLSX from "xlsx";
import { format, parse, addHours, startOfHour, getHours, getDay } from "date-fns";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/analyze", upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      // Basic normalization and cleaning
      const data = rawData.map((row: any) => {
        // Try to find timestamp and load columns
        // This is a simplified version of the Python logic
        const timestampKey = Object.keys(row).find(k => k.toLowerCase().includes("time") || k.toLowerCase().includes("date"));
        const loadKey = Object.keys(row).find(k => k.toLowerCase().includes("kw") || k.toLowerCase().includes("import"));
        
        return {
          timestamp: timestampKey ? new Date(row[timestampKey]).toISOString() : null,
          net_kw: loadKey ? parseFloat(row[loadKey]) || 0 : 0
        };
      }).filter(d => d.timestamp && !isNaN(new Date(d.timestamp).getTime()));

      res.json({ data });
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Failed to analyze file" });
    }
  });

  // Simulation Route
  app.post("/api/simulate", (req, res) => {
    const { 
      data, 
      hvacShare, 
      preCoolStart, 
      preCoolEnd, 
      peakStart, 
      peakEnd, 
      normalSetpoint, 
      precoolSetpoint, 
      maxComfortTemp, 
      throttleCap,
      thermalCapacity,
      thermalLoss,
      hvacCop,
      targetPeak
    } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data" });
    }

    // Ported Python simulation logic
    const dt_h = 0.5; // Assume 30 min intervals for now, or calculate from data
    let indoorTemp = normalSetpoint;
    
    const results = data.map((row: any, i: number) => {
      const ts = new Date(row.timestamp);
      const hour = ts.getHours();
      const day = ts.getDay();
      const isWeekend = day === 0 || day === 6;
      
      const isPeakWindow = !isWeekend && hour >= peakStart && hour < peakEnd;
      const isPrecoolWindow = !isWeekend && hour >= preCoolStart && hour < preCoolEnd;
      
      // Synthetic outdoor temp (simplified)
      const hourFloat = hour + ts.getMinutes() / 60;
      const dayAngle = 2 * Math.PI * (hourFloat - 15.0) / 24.0;
      const outdoorTemp = 31.0 + 3.5 * Math.cos(dayAngle);
      
      const baselineKw = row.net_kw;
      const hvacNominalKw = baselineKw * hvacShare;
      const nonHvacKw = Math.max(0, baselineKw - hvacNominalKw);
      
      let targetTemp = normalSetpoint;
      if (isPrecoolWindow) targetTemp = precoolSetpoint;
      else if (isPeakWindow && baselineKw >= targetPeak * 0.95) targetTemp = maxComfortTemp;
      
      const heatGainKw = Math.max(0, thermalLoss * (outdoorTemp - indoorTemp));
      const desiredCoolingKw = Math.max(0, heatGainKw + thermalCapacity * Math.max(0, indoorTemp - targetTemp) / dt_h);
      
      let hvacCapKw = hvacNominalKw;
      const isThrottling = isPeakWindow && baselineKw >= targetPeak * 0.95;
      if (isThrottling) hvacCapKw *= throttleCap;
      
      const hvacKw = Math.min(desiredCoolingKw / hvacCop, hvacCapKw);
      const coolingKw = hvacKw * hvacCop;
      
      indoorTemp = indoorTemp + ((heatGainKw - coolingKw) * dt_h / thermalCapacity);
      indoorTemp = Math.max(19.0, indoorTemp);
      
      const virtualSoc = Math.max(0, maxComfortTemp - indoorTemp) * thermalCapacity;
      const optimizedKw = nonHvacKw + hvacKw;

      return {
        ...row,
        optimized_kw: optimizedKw,
        indoor_temp: indoorTemp,
        virtual_soc: virtualSoc,
        is_throttling: isThrottling,
        outdoor_temp: outdoorTemp
      };
    });

    res.json({ results });
  });

  // Forecast Route
  app.post("/api/forecast", (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data" });
    }

    // Simple seasonal forecast (average of same hour across days)
    const hourlyAverages: Record<number, number[]> = {};
    data.forEach((d: any) => {
      const hour = new Date(d.timestamp).getHours();
      if (!hourlyAverages[hour]) hourlyAverages[hour] = [];
      hourlyAverages[hour].push(d.net_kw);
    });

    const lastTs = new Date(data[data.length - 1].timestamp);
    const forecast = [];
    for (let i = 1; i <= 48; i++) { // 24 hours at 30 min intervals
      const nextTs = new Date(lastTs.getTime() + i * 30 * 60 * 1000);
      const hour = nextTs.getHours();
      const avg = hourlyAverages[hour] ? hourlyAverages[hour].reduce((a, b) => a + b, 0) / hourlyAverages[hour].length : 0;
      
      // Add some noise and trend
      const noise = (Math.random() - 0.5) * (avg * 0.1);
      forecast.push({
        timestamp: nextTs.toISOString(),
        forecast_kw: Math.max(0, avg + noise)
      });
    }

    res.json({ forecast });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
//change
