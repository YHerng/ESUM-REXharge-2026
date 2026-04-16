/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, BarChart, Bar
} from 'recharts';
import { 
  Upload, Activity, Zap, Thermometer, Battery, Download, Info, AlertTriangle, ChevronRight, LayoutDashboard, TrendingUp, Settings, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface DataPoint {
  timestamp: string;
  net_kw: number;
  optimized_kw?: number;
  indoor_temp?: number;
  virtual_soc?: number;
  is_throttling?: boolean;
  outdoor_temp?: number;
}

interface SimulationParams {
  hvacShare: number;
  preCoolStart: number;
  preCoolEnd: number;
  peakStart: number;
  peakEnd: number;
  normalSetpoint: number;
  precoolSetpoint: number;
  maxComfortTemp: number;
  throttleCap: number;
  thermalCapacity: number;
  thermalLoss: number;
  hvacCop: number;
  targetPeak: number;
}

// --- Components ---

const Card = ({ children, className, title, icon: Icon }: { children: React.ReactNode, className?: string, title?: string, icon?: any }) => (
  <div className={cn("bg-bento-card border border-bento-border rounded-2xl overflow-hidden shadow-2xl", className)}>
    {title && (
      <div className="px-5 py-4 border-b border-bento-border flex items-center gap-3 bg-bento-card/50">
        {Icon && <Icon className="w-4 h-4 text-bento-accent" />}
        <h3 className="text-[10px] font-bold text-bento-text-dim uppercase tracking-[0.2em]">{title}</h3>
      </div>
    )}
    <div className="p-5">{children}</div>
  </div>
);

const Metric = ({ label, value, unit, icon: Icon, trend }: { label: string, value: string | number, unit?: string, icon: any, trend?: { value: string, positive: boolean } }) => (
  <Card className="flex flex-col gap-1 hover:border-bento-accent/50 transition-colors group">
    <div className="flex items-center justify-between">
      <div className="p-2.5 bg-bento-bg border border-bento-border rounded-xl group-hover:border-bento-accent/30 transition-colors">
        <Icon className="w-5 h-5 text-bento-accent" />
      </div>
      {trend && (
        <span className={cn("text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider", trend.positive ? "bg-bento-success/10 text-bento-success" : "bg-bento-danger/10 text-bento-danger")}>
          {trend.value}
        </span>
      )}
    </div>
    <div className="mt-4">
      <p className="text-[10px] font-bold text-bento-text-dim uppercase tracking-[0.15em] mb-1">{label}</p>
      <p className="text-3xl font-bold text-bento-text tracking-tight">
        {value} <span className="text-sm font-normal text-bento-text-dim ml-1">{unit}</span>
      </p>
    </div>
  </Card>
);

export default function App() {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'forecast' | 'peaks' | 'strategy' | 'results'>('overview');
  const [forecast, setForecast] = useState<any[]>([]);

  const runForecast = async () => {
    if (data.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data })
      });
      const result = await res.json();
      if (result.forecast) {
        setForecast(result.forecast);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  const [params, setParams] = useState<SimulationParams>({
    hvacShare: 0.45,
    preCoolStart: 7,
    preCoolEnd: 9,
    peakStart: 14,
    peakEnd: 22,
    normalSetpoint: 24,
    precoolSetpoint: 21,
    maxComfortTemp: 24,
    throttleCap: 0.6,
    thermalCapacity: 300,
    thermalLoss: 12,
    hvacCop: 3.5,
    targetPeak: 0
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      if (result.data) {
        setData(result.data);
        // Set default target peak to 95th percentile
        const sorted = [...result.data].sort((a, b) => a.net_kw - b.net_kw);
        const p95 = sorted[Math.floor(sorted.length * 0.95)]?.net_kw || 0;
        setParams(prev => ({ ...prev, targetPeak: p95 }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const runSimulation = async () => {
    if (data.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, ...params })
      });
      const result = await res.json();
      if (result.results) {
        setData(result.results);
        setActiveTab('results');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const baselineMd = Math.max(...data.map(d => d.net_kw));
    const optimizedMd = Math.max(...data.map(d => d.optimized_kw || d.net_kw));
    const mdReduction = baselineMd - optimizedMd;
    const mdReductionPct = (mdReduction / baselineMd) * 100;
    
    const energyRate = 0.40; // RM/kWh
    const oldMdRate = 30.30;
    const newMdRate = 97.06;
    
    const totalEnergy = data.reduce((acc, d) => acc + d.net_kw * 0.5, 0);
    const baselineBill = totalEnergy * energyRate + baselineMd * newMdRate;
    const optimizedBill = totalEnergy * energyRate + optimizedMd * newMdRate;
    const savings = baselineBill - optimizedBill;

    return {
      baselineMd,
      optimizedMd,
      mdReduction,
      mdReductionPct,
      savings,
      totalEnergy
    };
  }, [data]);

  const peakPeriods = useMemo(() => {
    if (data.length === 0) return [];
    const threshold = params.targetPeak || 0;
    const periods: any[] = [];
    let current: any = null;

    data.forEach((d, i) => {
      if (d.net_kw >= threshold) {
        if (!current) {
          current = { start: d.timestamp, max: d.net_kw, count: 1 };
        } else {
          current.max = Math.max(current.max, d.net_kw);
          current.count++;
        }
      } else if (current) {
        current.end = d.timestamp;
        periods.push(current);
        current = null;
      }
    });
    return periods.sort((a, b) => b.max - a.max).slice(0, 5);
  }, [data, params.targetPeak]);

  return (
    <div className="min-h-screen bg-bento-bg text-bento-text font-sans selection:bg-bento-accent/30">
      {/* Header */}
      <header className="bg-bento-bg border-b border-bento-border sticky top-0 z-20 backdrop-blur-md bg-bento-bg/80">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-bento-accent rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-bento-accent/20 rotate-3 hover:rotate-0 transition-transform duration-300">
              <Zap className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter uppercase italic">REX<span className="text-bento-accent">HARGE</span></h1>
              <p className="text-[9px] font-black text-bento-text-dim uppercase tracking-[0.3em]">Energy Intelligence v2.0</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-5 py-2.5 bg-bento-card border border-bento-border rounded-xl text-xs font-bold text-bento-text-dim hover:text-bento-text hover:border-bento-accent/50 cursor-pointer transition-all shadow-lg">
              <Upload className="w-4 h-4 text-bento-accent" />
              IMPORT DATA
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".xlsx,.csv" />
            </label>
            <button 
              onClick={runSimulation}
              disabled={data.length === 0 || loading}
              className="px-6 py-2.5 bg-bento-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xl shadow-bento-accent/30 transition-all flex items-center gap-2"
            >
              {loading ? "PROCESSING..." : "RUN SIMULATION"}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-24 h-24 bg-bento-card border border-bento-border rounded-3xl flex items-center justify-center mb-8 shadow-2xl rotate-6">
              <FileText className="w-12 h-12 text-bento-accent" />
            </div>
            <h2 className="text-3xl font-black text-bento-text mb-3 tracking-tighter uppercase italic">No Data <span className="text-bento-accent">Detected</span></h2>
            <p className="text-bento-text-dim max-w-md mb-10 text-sm font-medium leading-relaxed">
              Upload your historical load data (Excel or CSV) to start analyzing peak demand and simulating virtual battery strategies.
            </p>
            <div className="flex gap-4">
              <label className="px-8 py-4 bg-bento-accent text-white rounded-2xl font-black uppercase tracking-widest hover:brightness-110 cursor-pointer shadow-2xl shadow-bento-accent/30 transition-all">
                Choose File
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".xlsx,.csv" />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Metric 
                label="Baseline Peak" 
                value={stats?.baselineMd.toFixed(1) || 0} 
                unit="kW" 
                icon={Activity} 
              />
              <Metric 
                label="Optimized Peak" 
                value={stats?.optimizedMd.toFixed(1) || 0} 
                unit="kW" 
                icon={Zap}
                trend={stats?.mdReductionPct ? { value: `-${stats.mdReductionPct.toFixed(1)}%`, positive: true } : undefined}
              />
              <Metric 
                label="Est. Savings" 
                value={stats?.savings.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0} 
                unit="RM" 
                icon={TrendingUp} 
              />
              <Metric 
                label="Total Energy" 
                value={stats?.totalEnergy.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0} 
                unit="kWh" 
                icon={Battery} 
              />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 p-1.5 bg-bento-card border border-bento-border rounded-2xl w-fit shadow-xl">
              {[
                { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                { id: 'forecast', label: 'Forecast', icon: TrendingUp },
                { id: 'peaks', label: 'Peak Analysis', icon: Activity },
                { id: 'strategy', label: 'Strategy', icon: Settings },
                { id: 'results', label: 'Simulation Results', icon: TrendingUp },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                    activeTab === tab.id 
                      ? "bg-bento-accent text-white shadow-lg shadow-bento-accent/20" 
                      : "text-bento-text-dim hover:text-bento-text hover:bg-white/5"
                  )}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'overview' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="lg:col-span-2" title="Historical Load Profile" icon={Activity}>
                      <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data.slice(0, 200)}>
                            <defs>
                              <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#7C5DFF" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#7C5DFF" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis 
                              tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
                              itemStyle={{ color: '#E0E0E6', fontSize: '12px', fontWeight: 600 }}
                              labelStyle={{ color: '#9499B0', fontSize: '10px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}
                            />
                            <Area type="monotone" dataKey="net_kw" stroke="#7C5DFF" strokeWidth={3} fillOpacity={1} fill="url(#colorLoad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                    <div className="space-y-6">
                      <Card title="Top Peak Events" icon={AlertTriangle}>
                        <div className="space-y-4">
                          {peakPeriods.map((p, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-bento-bg border border-bento-border rounded-xl hover:border-bento-danger/30 transition-colors">
                              <div>
                                <p className="text-[9px] font-black text-bento-text-dim uppercase tracking-widest mb-1">{new Date(p.start).toLocaleDateString()}</p>
                                <p className="text-sm font-bold text-bento-text">{new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xl font-black text-bento-danger tracking-tighter">{p.max.toFixed(1)} <span className="text-[10px] font-bold">kW</span></p>
                                <p className="text-[9px] text-bento-text-dim uppercase font-black tracking-widest">{p.count * 30} MINS</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                      <Card title="Quick Info" icon={Info}>
                        <div className="space-y-4 text-xs font-bold text-bento-text-dim uppercase tracking-widest">
                          <div className="flex justify-between items-center">
                            <span>Data Points</span>
                            <span className="text-bento-text">{data.length}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Avg Load</span>
                            <span className="text-bento-text">{(data.reduce((a, b) => a + b.net_kw, 0) / data.length).toFixed(1)} kW</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Target Cap</span>
                            <span className="text-bento-accent">{params.targetPeak.toFixed(1)} kW</span>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </div>
                )}

                {activeTab === 'forecast' && (
                  <div className="space-y-6">
                    <Card title="24-Hour Load Forecast" icon={TrendingUp}>
                      <div className="flex justify-between items-center mb-8">
                        <p className="text-sm text-bento-text-dim font-medium">Predicted load based on historical seasonal patterns and trends.</p>
                        <button 
                          onClick={runForecast}
                          className="px-5 py-2.5 bg-bento-bg border border-bento-border text-bento-text rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-bento-accent/50 transition-all shadow-lg"
                        >
                          Refresh Forecast
                        </button>
                      </div>
                      <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={forecast}>
                            <defs>
                              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#7C5DFF" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#7C5DFF" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
                              itemStyle={{ color: '#E0E0E6', fontSize: '12px', fontWeight: 600 }}
                              labelStyle={{ color: '#9499B0', fontSize: '10px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}
                            />
                            <Area type="monotone" dataKey="forecast_kw" stroke="#7C5DFF" strokeWidth={3} fillOpacity={1} fill="url(#colorForecast)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  </div>
                )}

                {activeTab === 'peaks' && (
                  <div className="space-y-6">
                    <Card title="Peak Demand Identification" icon={Activity}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        <div className="space-y-8">
                          <p className="text-sm text-bento-text-dim leading-relaxed font-medium">
                            Identifying periods where load exceeds the target threshold. These are the critical windows for virtual battery dispatch.
                          </p>
                          <div className="space-y-4">
                            {peakPeriods.map((p, i) => (
                              <div key={i} className="flex items-center justify-between p-5 bg-bento-bg border border-bento-border rounded-2xl hover:border-bento-danger/30 transition-colors group">
                                <div className="flex items-center gap-5">
                                  <div className="w-12 h-12 bg-bento-danger/10 rounded-xl flex items-center justify-center text-bento-danger group-hover:scale-110 transition-transform">
                                    <AlertTriangle className="w-6 h-6" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-1">{new Date(p.start).toLocaleDateString()}</p>
                                    <p className="text-sm font-bold text-bento-text">{new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(p.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-2xl font-black text-bento-danger tracking-tighter">{p.max.toFixed(1)} kW</p>
                                  <p className="text-[9px] font-black text-bento-text-dim uppercase tracking-widest">MAX DEMAND</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="h-[400px] bg-bento-bg rounded-2xl border border-bento-border p-6 shadow-inner">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={peakPeriods}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                              <XAxis dataKey="start" tickFormatter={(val) => new Date(val).toLocaleDateString()} tick={{fontSize: 10, fill: '#9499B0', fontWeight: 600}} axisLine={false} tickLine={false} />
                              <YAxis tick={{fontSize: 10, fill: '#9499B0', fontWeight: 600}} axisLine={false} tickLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E' }}
                                itemStyle={{ color: '#E0E0E6', fontSize: '12px', fontWeight: 600 }}
                              />
                              <Bar dataKey="max" fill="#EF4444" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {activeTab === 'strategy' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <Card title="Control Parameters" icon={Settings}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">HVAC Load Share ({(params.hvacShare * 100).toFixed(0)}%)</span>
                            <input 
                              type="range" min="0.1" max="0.8" step="0.05" 
                              value={params.hvacShare} 
                              onChange={e => setParams({...params, hvacShare: parseFloat(e.target.value)})}
                              className="w-full h-1.5 bg-bento-bg border border-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">Normal Setpoint ({params.normalSetpoint}°C)</span>
                            <input 
                              type="range" min="20" max="26" step="0.5" 
                              value={params.normalSetpoint} 
                              onChange={e => setParams({...params, normalSetpoint: parseFloat(e.target.value)})}
                              className="w-full h-1.5 bg-bento-bg border border-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">Pre-cool Setpoint ({params.precoolSetpoint}°C)</span>
                            <input 
                              type="range" min="18" max="24" step="0.5" 
                              value={params.precoolSetpoint} 
                              onChange={e => setParams({...params, precoolSetpoint: parseFloat(e.target.value)})}
                              className="w-full h-1.5 bg-bento-bg border border-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent"
                            />
                          </label>
                        </div>
                        <div className="space-y-6">
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">Peak Window ({params.peakStart}:00 - {params.peakEnd}:00)</span>
                            <div className="flex gap-3">
                              <input type="number" value={params.peakStart} onChange={e => setParams({...params, peakStart: parseInt(e.target.value)})} className="w-full p-3 bg-bento-bg border border-bento-border rounded-xl text-sm font-bold text-bento-text focus:border-bento-accent/50 outline-none transition-colors" />
                              <input type="number" value={params.peakEnd} onChange={e => setParams({...params, peakEnd: parseInt(e.target.value)})} className="w-full p-3 bg-bento-bg border border-bento-border rounded-xl text-sm font-bold text-bento-text focus:border-bento-accent/50 outline-none transition-colors" />
                            </div>
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">Target Peak Cap ({params.targetPeak.toFixed(0)} kW)</span>
                            <input 
                              type="number" value={params.targetPeak} 
                              onChange={e => setParams({...params, targetPeak: parseFloat(e.target.value)})}
                              className="w-full p-3 bg-bento-bg border border-bento-border rounded-xl text-sm font-bold text-bento-text focus:border-bento-accent/50 outline-none transition-colors"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest mb-3 block">Throttle Cap ({(params.throttleCap * 100).toFixed(0)}%)</span>
                            <input 
                              type="range" min="0.3" max="1.0" step="0.1" 
                              value={params.throttleCap} 
                              onChange={e => setParams({...params, throttleCap: parseFloat(e.target.value)})}
                              className="w-full h-1.5 bg-bento-bg border border-bento-border rounded-lg appearance-none cursor-pointer accent-bento-accent"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="mt-10 pt-8 border-t border-bento-border">
                        <button 
                          onClick={runSimulation}
                          className="w-full py-4 bg-bento-accent text-white rounded-2xl font-black uppercase tracking-widest hover:brightness-110 shadow-2xl shadow-bento-accent/30 transition-all"
                        >
                          Apply & Simulate
                        </button>
                      </div>
                    </Card>
                    <Card title="Building Physics" icon={Activity}>
                      <div className="space-y-8">
                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <p className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest">Thermal Capacity</p>
                            <div className="flex items-center gap-3">
                              <input type="number" value={params.thermalCapacity} onChange={e => setParams({...params, thermalCapacity: parseFloat(e.target.value)})} className="w-full p-3 bg-bento-bg border border-bento-border rounded-xl text-sm font-bold text-bento-text focus:border-bento-accent/50 outline-none transition-colors" />
                              <span className="text-[10px] font-bold text-bento-text-dim uppercase tracking-widest">kWh/°C</span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[10px] font-black text-bento-text-dim uppercase tracking-widest">Thermal Loss</p>
                            <div className="flex items-center gap-3">
                              <input type="number" value={params.thermalLoss} onChange={e => setParams({...params, thermalLoss: parseFloat(e.target.value)})} className="w-full p-3 bg-bento-bg border border-bento-border rounded-xl text-sm font-bold text-bento-text focus:border-bento-accent/50 outline-none transition-colors" />
                              <span className="text-[10px] font-bold text-bento-text-dim uppercase tracking-widest">kW/°C</span>
                            </div>
                          </div>
                        </div>
                        <div className="p-5 bg-bento-accent/5 rounded-2xl border border-bento-accent/20">
                          <div className="flex gap-4">
                            <Info className="w-6 h-6 text-bento-accent shrink-0" />
                            <p className="text-xs text-bento-text-dim leading-relaxed font-medium">
                              These parameters define how the building responds to cooling. <strong>Thermal Capacity</strong> represents the "size" of your virtual battery, while <strong>Thermal Loss</strong> defines how quickly it "discharges" based on outdoor temperature.
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {activeTab === 'results' && (
                  <div className="space-y-8">
                    <Card title="Load Shifting Comparison" icon={TrendingUp}>
                      <div className="h-[450px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={data.slice(0, 200)}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis 
                              tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
                              itemStyle={{ color: '#E0E0E6', fontSize: '12px', fontWeight: 600 }}
                              labelStyle={{ color: '#9499B0', fontSize: '10px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}
                            />
                            <Legend verticalAlign="top" height={48} iconType="circle" />
                            <Line type="monotone" dataKey="net_kw" name="Baseline" stroke="#9499B0" strokeWidth={2} dot={false} strokeDasharray="6 6" opacity={0.5} />
                            <Line type="monotone" dataKey="optimized_kw" name="Optimized" stroke="#7C5DFF" strokeWidth={4} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <Card title="Indoor Temperature Drift" icon={Thermometer}>
                        <div className="h-[350px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.slice(0, 200)}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                              <XAxis 
                                dataKey="timestamp" 
                                tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis domain={[18, 26]} tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E' }}
                              />
                              <Line type="monotone" dataKey="indoor_temp" stroke="#F59E0B" strokeWidth={3} dot={false} />
                              <Line type="monotone" dataKey="outdoor_temp" stroke="#2D303E" strokeWidth={1} dot={false} strokeDasharray="4 4" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                      <Card title="Virtual Battery SOC" icon={Battery}>
                        <div className="h-[350px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.slice(0, 200)}>
                              <defs>
                                <linearGradient id="colorSoc" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2D303E" />
                              <XAxis 
                                dataKey="timestamp" 
                                tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis tick={{ fontSize: 10, fill: '#9499B0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#161821', borderRadius: '12px', border: '1px solid #2D303E' }}
                              />
                              <Area type="monotone" dataKey="virtual_soc" stroke="#10B981" strokeWidth={3} fillOpacity={1} fill="url(#colorSoc)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-16 border-t border-bento-border mt-16">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3 opacity-40 hover:opacity-100 transition-opacity cursor-default">
            <Zap className="w-6 h-6 text-bento-accent" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em]">REXHARGE INTELLIGENCE v2.0</span>
          </div>
          <div className="flex gap-10 text-[10px] font-black text-bento-text-dim uppercase tracking-widest">
            <a href="#" className="hover:text-bento-accent transition-colors">Documentation</a>
            <a href="#" className="hover:text-bento-accent transition-colors">Tariff Guide</a>
            <a href="#" className="hover:text-bento-accent transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
