import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as XLSX from "xlsx";
import { format, parse, addHours, startOfHour, getHours, getDay } from "date-fns";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API Routes
  app.post("/api/analyze", upload.array("files"), async (req: any, res) => {
    console.log(`Received ${req.files?.length || 0} files for analysis`);
    try {
      if (!req.files || req.files.length === 0) {
        console.warn("No files in request");
        return res.status(400).json({ error: "No files uploaded. Please select one or more .xlsx, .xls, or .csv files." });
      }

      let allData: any[] = [];

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const extension = file.originalname.split('.').pop()?.toLowerCase();
        console.log(`Processing file ${i + 1}/${req.files.length}: ${file.originalname} (Ext: ${extension}, Size: ${file.size} bytes)`);
        
        try {
          const workbook = XLSX.read(file.buffer, { 
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
            raw: true
          });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Get raw rows to find the header
          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
          if (rows.length === 0) {
            console.warn(`File ${file.originalname} is empty`);
            continue;
          }

        // Find header row (the one with time/date and load keywords)
        let headerIdx = -1;
        for (let r = 0; r < Math.min(rows.length, 50); r++) {
          const row = rows[r];
          if (!row || !Array.isArray(row)) continue;
          
          const rowStr = row.join("|").toLowerCase();
          const hasTime = rowStr.includes("time") || rowStr.includes("date") || rowStr.includes("period") || rowStr.includes("clock");
          const hasLoad = rowStr.includes("kw") || rowStr.includes("load") || rowStr.includes("usage") || 
                          rowStr.includes("consumption") || rowStr.includes("active") || rowStr.includes("power") || 
                          rowStr.includes("demand") || rowStr.includes("reading") || rowStr.includes("value");
          
          if (hasTime && hasLoad) {
            headerIdx = r;
            break;
          }
        }

        // Fallback: search for any row that has at least 3 numeric values (likely data start)
        if (headerIdx === -1) {
          for (let r = 0; r < Math.min(rows.length, 50); r++) {
            const row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            const numericCount = row.filter(cell => typeof cell === 'number').length;
            if (numericCount >= 2) {
              headerIdx = Math.max(0, r - 1); // Assume header is the row above
              break;
            }
          }
        }

        // If no clear header found, assume row 0 or first non-empty row
        if (headerIdx === -1) {
          headerIdx = rows.findIndex(r => r && r.length > 0);
        }

        if (headerIdx === -1) continue;

        const headers = rows[headerIdx].map(h => String(h || "").trim());
        const dataRows = rows.slice(headerIdx + 1);

        const timestampIdx = headers.findIndex(h => {
          const low = h.toLowerCase();
          return low.includes("time") || low.includes("date") || low.includes("period") || low.includes("clock") || low.includes("timestamp");
        });

        let loadIdx = -1;
        let bestScore = 0;
        headers.forEach((h, idx) => {
          const low = h.toLowerCase();
          let score = 0;
          if (low.includes("kw") || low.includes("kwh") || low.includes("watt")) score += 10;
          if (low.includes("import") || low.includes("load") || low.includes("usage") || low.includes("consumption")) score += 5;
          if (low.includes("active") || low.includes("power") || low.includes("demand")) score += 3;
          if (low.includes("reading") || low.includes("value") || low.includes("total") || low.includes("energy") || low.includes("electricity")) score += 2;
          if (low.includes("current") || low.includes("meter") || low.includes("billing") || low.includes("cost") || low.includes("amount")) score += 1;
          // Penalize export columns
          if (low.includes("export")) score -= 20;
          
          if (score > bestScore) {
            bestScore = score;
            loadIdx = idx;
          }
        });

        // Fallback: find column with most numeric values and highest average (likely the load column)
        if (loadIdx === -1) {
          let bestIdx = -1;
          let bestScore = 0;
          for (let i = 0; i < headers.length; i++) {
            if (i === timestampIdx) continue;
            const numericCount = dataRows.filter(dr => dr && dr[i] !== null && dr[i] !== undefined && (typeof dr[i] === 'number' || (typeof dr[i] === 'string' && !isNaN(parseFloat(dr[i].replace(/[^0-9.,]/g, '').replace(',', '.')))))).length;
            const avg = dataRows.reduce((sum, dr) => {
              if (dr && dr[i] !== null && dr[i] !== undefined) {
                const val = typeof dr[i] === 'number' ? dr[i] : parseFloat((dr[i] as string).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
                return sum + val;
              }
              return sum;
            }, 0) / dataRows.length;
            const score = numericCount * 10 + avg; // Prefer columns with more numbers and higher average
            if (score > bestScore) {
              bestScore = score;
              bestIdx = i;
            }
          }
          loadIdx = bestIdx;
          console.log(`Fallback selected column ${loadIdx} with score ${bestScore}`);
        }

        console.log(`Detected headers: [${headers.join(", ")}]`);
        console.log(`Using columns: Timestamp=${timestampIdx >= 0 ? headers[timestampIdx] : 'NOT FOUND'}, Load=${loadIdx >= 0 ? headers[loadIdx] : 'NOT FOUND'}`);

        // Log first few data rows for debugging
        console.log("First 5 data rows:");
        dataRows.slice(0, 5).forEach((row, idx) => {
          console.log(`Row ${idx}: [${row.map(cell => typeof cell === 'string' ? `"${cell}"` : cell).join(", ")}]`);
        });

        const data = dataRows.map((row: any[], rowIdx: number) => {
          let net_kw = 0;
          if (loadIdx !== -1) {
            const val = row[loadIdx];
            if (typeof val === 'number') {
              net_kw = val;
            } else if (typeof val === 'string') {
              // Handle both . and , as decimal separators
              const cleanVal = val.replace(/[^0-9.,]/g, '').replace(',', '.');
              net_kw = parseFloat(cleanVal) || 0;
            }
          }

          if (rowIdx < 3) {
            console.log(`Row ${rowIdx} load value: ${row[loadIdx]} -> net_kw: ${net_kw}`);
          }

          let timestamp = null;
          if (timestampIdx !== -1) {
            const dateVal = row[timestampIdx];
            if (typeof dateVal === 'number' && dateVal > 40000) {
              const excelDate = XLSX.SSF.parse_date_code(dateVal);
              timestamp = new Date(excelDate.y, excelDate.m - 1, excelDate.d, excelDate.H, excelDate.M, excelDate.S).toISOString();
            } else if (dateVal) {
              const parsedDate = new Date(dateVal);
              if (!isNaN(parsedDate.getTime())) {
                timestamp = parsedDate.toISOString();
              }
            }
          }
          
          return { timestamp, net_kw };
        }).filter(d => d.timestamp !== null);

        allData = [...allData, ...data];
        } catch (fileError) {
          console.error(`Error parsing file ${file.originalname}:`, fileError);
          // Continue with other files if one fails
        }
      }

      if (allData.length === 0) {
        return res.status(400).json({ error: "No valid data found in the uploaded files" });
      }

      // Sort by timestamp and remove duplicates
      const dataWithTime = allData.map(d => ({ ...d, time: new Date(d.timestamp).getTime() }));
      dataWithTime.sort((a, b) => a.time - b.time);
      
      const uniqueData = [];
      const seen = new Set();
      for (const d of dataWithTime) {
        if (!seen.has(d.time)) {
          seen.add(d.time);
          const { time, ...rest } = d;
          uniqueData.push(rest);
        }
      }

      res.json({ 
        data: uniqueData,
        metadata: {
          filesProcessed: req.files.length,
          totalPoints: uniqueData.length
        }
      });
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Failed to analyze files" });
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
      targetPeak,
      // New parameters for solar & battery
      latitude = 3.1390, // Kuala Lumpur default
      solarCapacity = 100, // kW
      batteryCapacity = 200, // kWh
      batteryEfficiency = 0.9,
      solarAzimuth = 180, // South facing
      solarTilt = 5 // degrees
    } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data" });
    }

    // Solar generation function
    function calculateSolarGeneration(ts: Date, capacity: number) {
      const hour = ts.getHours() + ts.getMinutes() / 60;
      const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
      
      // Solar position calculation (simplified)
      const declination = 23.45 * Math.sin((360/365) * (284 + dayOfYear) * Math.PI/180);
      const hourAngle = 15 * (hour - 12);
      
      const latRad = latitude * Math.PI/180;
      const decRad = declination * Math.PI/180;
      const tiltRad = solarTilt * Math.PI/180;
      const azimuthRad = solarAzimuth * Math.PI/180;
      
      const elevation = Math.asin(Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourAngle * Math.PI/180));
      const azimuth = Math.atan2(Math.sin(hourAngle * Math.PI/180), Math.cos(hourAngle * Math.PI/180) * Math.sin(latRad) - Math.tan(decRad) * Math.cos(latRad));
      
      if (elevation < 0) return 0; // Night time
      
      // Air mass and irradiance (simplified)
      const airMass = 1 / Math.cos((Math.PI/2) - elevation);
      const irradiance = 1000 * Math.pow(0.7, Math.pow(airMass, 0.678)); // Clear sky model
      
      // PV generation (simplified efficiency model)
      const efficiency = 0.18; // 18% panel efficiency
      const temperatureCoeff = -0.004; // %/°C
      const ambientTemp = 25; // Assume 25°C ambient
      const cellTemp = ambientTemp + irradiance * (0.025 / 0.8); // NOCT model
      const adjustedEfficiency = efficiency * (1 + temperatureCoeff * (cellTemp - 25));
      
      return Math.max(0, irradiance * adjustedEfficiency * capacity / 1000); // kW
    }

    // Ported Python simulation logic with solar & battery
    const dt_h = 0.5; // Assume 30 min intervals
    let indoorTemp = normalSetpoint;
    let batterySoc = batteryCapacity * 0.5; // Start at 50% SOC
    
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
      
      // Solar generation
      const solarKw = calculateSolarGeneration(ts, solarCapacity);
      
      // Net load before battery
      let netLoadKw = baselineKw - solarKw;
      
      // Battery operation
      let batteryPower = 0;
      if (isPeakWindow && netLoadKw > targetPeak) {
        // Discharge to reduce peak
        const dischargeNeeded = netLoadKw - targetPeak;
        const maxDischarge = Math.min(dischargeNeeded, batteryCapacity * 2, batterySoc * batteryEfficiency); // 2h discharge rate
        batteryPower = -maxDischarge;
        batterySoc = Math.max(0, batterySoc - maxDischarge * dt_h);
      } else if (!isPeakWindow && netLoadKw < targetPeak * 0.8 && batterySoc < batteryCapacity) {
        // Charge when load is low
        const chargeAvailable = targetPeak * 0.8 - netLoadKw;
        const maxCharge = Math.min(chargeAvailable, batteryCapacity * 2, (batteryCapacity - batterySoc) / batteryEfficiency);
        batteryPower = maxCharge;
        batterySoc = Math.min(batteryCapacity, batterySoc + maxCharge * dt_h * batteryEfficiency);
      }
      
      // Apply battery power to net load
      netLoadKw += batteryPower;
      
      // HVAC optimization
      let targetTemp = normalSetpoint;
      if (isPrecoolWindow) targetTemp = precoolSetpoint;
      else if (isPeakWindow && netLoadKw >= targetPeak * 0.95) targetTemp = maxComfortTemp;
      
      const heatGainKw = Math.max(0, thermalLoss * (outdoorTemp - indoorTemp));
      const desiredCoolingKw = Math.max(0, heatGainKw + thermalCapacity * Math.max(0, indoorTemp - targetTemp) / dt_h);
      
      let hvacCapKw = hvacNominalKw;
      const isThrottling = isPeakWindow && netLoadKw >= targetPeak * 0.95;
      if (isThrottling) hvacCapKw *= throttleCap;
      
      const hvacKw = Math.min(desiredCoolingKw / hvacCop, hvacCapKw);
      const coolingKw = hvacKw * hvacCop;
      
      indoorTemp = indoorTemp + ((heatGainKw - coolingKw) * dt_h / thermalCapacity);
      indoorTemp = Math.max(19.0, indoorTemp);
      
      const virtualSoc = Math.max(0, maxComfortTemp - indoorTemp) * thermalCapacity;
      const optimizedKw = Math.max(0, nonHvacKw + hvacKw - solarKw + batteryPower);

      return {
        ...row,
        optimized_kw: optimizedKw,
        indoor_temp: indoorTemp,
        virtual_soc: virtualSoc,
        is_throttling: isThrottling,
        outdoor_temp: outdoorTemp,
        solar_generation: solarKw,
        battery_power: batteryPower,
        battery_soc: batterySoc,
        net_load: netLoadKw
      };
    });

    // Calculate sizing recommendations
    const totalLoad = data.reduce((sum, d) => sum + d.net_kw * dt_h, 0);
    const peakLoad = Math.max(...data.map(d => d.net_kw));
    const avgLoad = totalLoad / (data.length * dt_h);
    
    // Solar sizing: aim for 30-50% of average load
    const recommendedSolar = Math.min(peakLoad * 0.8, avgLoad * 2);
    
    // Battery sizing: based on peak shaving potential
    const peakHours = data.filter(d => {
      const hour = new Date(d.timestamp).getHours();
      return hour >= peakStart && hour < peakEnd;
    });
    const avgPeakLoad = peakHours.reduce((sum, d) => sum + d.net_kw, 0) / peakHours.length;
    const recommendedBattery = Math.max(50, (avgPeakLoad - targetPeak) * 4); // 4 hours storage
    
    res.json({ 
      results,
      recommendations: {
        solarCapacity: Math.round(recommendedSolar),
        batteryCapacity: Math.round(recommendedBattery),
        estimatedSavings: Math.round((peakLoad - targetPeak) * 100 * 0.15), // Rough estimate
        paybackYears: Math.round((recommendedSolar * 1500 + recommendedBattery * 500) / ((peakLoad - targetPeak) * 100 * 0.15)) // Rough payback
      }
    });
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
