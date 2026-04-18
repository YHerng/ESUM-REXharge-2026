# REXHARGE - Virtual Battery & Peak Shaving Dashboard

An advanced energy management platform that combines AI-powered load forecasting, automated load shifting strategies, and solar + battery optimization for peak demand reduction and cost savings.

## Features

### 🔋 **Virtual Battery Management**
- HVAC-based thermal storage simulation
- Automated pre-cooling strategies
- Real-time thermal capacity monitoring
- Comfort temperature optimization

### ☀️ **Solar PV Integration**
- Real-time solar generation modeling
- Location-based irradiance calculations
- Tilt and azimuth optimization
- Temperature-corrected efficiency

### 🔋 **Battery Storage Optimization**
- Smart charge/discharge algorithms
- State-of-charge management
- Peak shaving during high-demand periods
- Off-peak charging strategies

### 📊 **Advanced Analytics**
- Multi-file data ingestion (Excel/CSV)
- Historical load forecasting
- Peak demand identification
- Cost savings simulation
- Interactive dashboard with real-time charts

### 🎯 **Competition Ready**
- Supports up to 4 dataset files
- Automated sizing recommendations
- Payback period calculations
- Exportable results and visualizations

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Open your browser** to `http://localhost:3000`

4. **Upload your data:**
   - Click "IMPORT DATA" to upload 1-4 Excel files
   - Files should contain timestamp and load (kW) columns
   - Supported formats: .xlsx, .xls, .csv

5. **Configure parameters:**
   - Adjust HVAC settings in the Strategy tab
   - Set solar PV and battery parameters in the Solar & Battery tab
   - Configure peak hours and target reductions

6. **Run simulation:**
   - Click "RUN SIMULATION" to process data
   - View results across Overview, Forecast, Peaks, Strategy, Sizing, and Results tabs

## Data Format Requirements

Your Excel files should contain:
- **Timestamp column**: Date/time data (Excel date format or ISO strings)
- **Load column**: kW consumption values
- Headers should include keywords like: "time", "date", "kw", "load", "usage", "consumption"

Example file structure:
```
Date / End Time | kW Import
45901.020833   | 74
45901.041667   | 74
```

## Key Parameters

### HVAC Virtual Battery
- **HVAC Share**: Portion of load controllable by HVAC (0.1-0.8)
- **Thermal Capacity**: Building's thermal storage capacity (kWh/°C)
- **Setpoint Temperatures**: Normal and pre-cool temperatures
- **Throttle Cap**: Maximum HVAC reduction during peaks

### Solar PV System
- **Capacity**: Installed solar capacity (kW)
- **Azimuth**: Panel orientation (degrees from north)
- **Tilt**: Panel angle from horizontal (degrees)
- **Latitude**: Location latitude for solar calculations

### Battery Storage
- **Capacity**: Battery energy capacity (kWh)
- **Efficiency**: Round-trip efficiency (0.8-0.95)
- **Charge/Discharge Rate**: Maximum power (kW)

## Competition Submission

For the competition, prepare 4 Excel files with similar datasets and:

1. Upload all files simultaneously
2. Run the complete simulation pipeline
3. Review AI-generated sizing recommendations
4. Export results and visualizations
5. Document your methodology and assumptions

The system will automatically:
- Forecast load demand using historical data
- Identify peak demand periods
- Propose optimized load shifting strategies
- Calculate solar & battery sizing requirements
- Simulate cost savings and peak reductions
- Generate comprehensive dashboard reports

## API Endpoints

- `POST /api/analyze` - Process uploaded Excel files
- `POST /api/simulate` - Run energy optimization simulation
- `POST /api/forecast` - Generate load forecasts

## Technologies Used

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express
- **Data Processing**: XLSX for Excel parsing
- **Visualization**: Recharts for interactive charts
- **AI**: Solar irradiance and optimization algorithms
