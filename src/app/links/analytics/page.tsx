'use client';

import React, { useState, useEffect } from 'react';
import { Shell } from '@/components/layout/shell';
import {
  Clock,
  Cursor,
  ExternalLink,
  Eye,
  Filter,
  Globe,
  LinkIcon,
} from '@/components/icons';

interface AnalyticsData {
  summary: {
    totalClicks: number;
    uniqueVisitors: number;
    activeLinks: number;
    topReferrer: string;
    lastClick: string;
  };
  timeSeries: { date: string; clicks: number }[];
  topLinks: { alias: string; dest: string; clicks: number; tag: string | null }[];
  topCountries: { country: string; code: string; count: number; pct: string }[];
  devices: { name: string; pct: string }[];
  browsers: { name: string; pct: string }[];
  os: { name: string; pct: string }[];
}

const FLAGS: Record<string, string> = {
  US: '🇺🇸',
  NG: '🇳🇬',
  GB: '🇬🇧',
  CA: '🇨🇦',
  OT: '🌍',
};

const DEVICE_GLYPHS: Record<string, string> = {
  Desktop: '💻',
  Mobile: '📱',
  Tablet: '📟',
};

const BROWSER_GLYPHS: Record<string, string> = {
  Chrome: '🌐',
  Safari: '🧭',
  Firefox: '🦊',
  Edge: '🅴',
};

const REFERRERS = [
  { name: 'slack.com', count: 412 },
  { name: 'Direct / none', count: 289 },
  { name: 'x.com', count: 187 },
  { name: 'linkedin.com', count: 116 },
];

function pctWidth(value: number, max: number) {
  if (!max) return '0%';
  return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [range, setRange] = useState<'7d' | '30d'>('30d');
  const [timeView, setTimeView] = useState<'day' | 'week' | 'month'>('week');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`/api/analytics/links?range=${range}`);
        setData(await res.json());
      } catch (e) {
        console.error('Failed to load analytics:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [range]);

  const renderChart = () => {
    const points = data?.timeSeries ?? [];
    if (points.length < 2) return null;

    const width = 800;
    const height = 220;
    const top = 30;
    const bottom = 200;
    const maxVal = Math.max(...points.map((p) => p.clicks), 1);

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = bottom - (p.clicks / maxVal) * (bottom - top);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = coords.join(' L ');
    const area = `M0,${bottom} L ${line} L${width},${bottom} Z`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0a0a" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#fill)" />
        <path d={`M ${line}`} fill="none" stroke="#0a0a0a" strokeWidth="1.5" />
      </svg>
    );
  };

  const axisLabels = () => {
    const points = data?.timeSeries ?? [];
    if (points.length === 0) return [];
    const count = 5;
    return Array.from({ length: count }, (_, i) => points[Math.round((i / (count - 1)) * (points.length - 1))].date);
  };

  const maxTopLink = Math.max(...(data?.topLinks ?? []).map((l) => l.clicks), 1);
  const maxCountry = Math.max(...(data?.topCountries ?? []).map((c) => c.count), 1);
  const maxReferrer = Math.max(...REFERRERS.map((r) => r.count), 1);

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>Analytics</span>
          <span className="placeholder-veil" style={{ marginLeft: '6px' }}>Preview</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline btn-sm">
            <Filter />
            <span>Filter</span>
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setRange(range === '30d' ? '7d' : '30d')}>
            <Clock />
            <span>{range === '30d' ? 'Last 30 days' : 'Last 7 days'}</span>
          </button>
          <button className="btn btn-outline btn-sm">
            <ExternalLink />
            <span>Export</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading analytics…</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label"><Cursor /><span>Clicks</span></div>
              <div className="stat-value">{data?.summary.totalClicks.toLocaleString()}</div>
              <div className="stat-delta">+12.4% vs last period</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Eye /><span>Unique visitors</span></div>
              <div className="stat-value">{data?.summary.uniqueVisitors.toLocaleString()}</div>
              <div className="stat-delta">+8.1% vs last period</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><LinkIcon width="11" height="11" /><span>Active links</span></div>
              <div className="stat-value">{data?.summary.activeLinks}</div>
              <div className="stat-delta">{data?.summary.activeLinks} live destinations</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Globe /><span>Top referring channel</span></div>
              <div className="stat-value" style={{ fontSize: '18px' }}>{data?.summary.topReferrer}</div>
              <div className="stat-delta">Highest traffic source</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Clock /><span>Last click</span></div>
              <div className="stat-value" style={{ fontSize: '18px' }}>{data?.summary.lastClick}</div>
              <div className="stat-delta">{data?.topLinks[0] ? `4th.link/${data.topLinks[0].alias}` : 'No clicks yet'}</div>
            </div>
          </div>

          {/* Clicks over time */}
          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">Clicks over time</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['day', 'week', 'month'] as const).map((v) => (
                  <button
                    key={v}
                    className={`btn btn-sm ${timeView === v ? 'btn-outline' : 'btn-ghost'}`}
                    onClick={() => setTimeView(v)}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-placeholder">{renderChart()}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '6px' }}>
              {axisLabels().map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          </div>

          {/* Split row */}
          <div className="split">
            <div className="split-card">
              <h4><span>Top links</span><span className="placeholder-veil">Coming soon</span></h4>
              {data?.topLinks.slice(0, 4).map((l, i) => (
                <div className="bar-row" key={l.alias}>
                  <div>{i + 1}</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>4th.link/{l.alias}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(l.clicks, maxTopLink) }} />
                    </div>
                  </div>
                  <div className="bar-count">{l.clicks}</div>
                </div>
              ))}
              {(!data?.topLinks || data.topLinks.length === 0) && (
                <div className="bar-row"><div /><div style={{ color: 'var(--muted-foreground)' }}>No data yet</div><div /></div>
              )}
            </div>

            <div className="split-card">
              <h4><span>Top countries</span><span className="placeholder-veil">Coming soon</span></h4>
              {data?.topCountries.map((c) => (
                <div className="bar-row" key={c.code}>
                  <div className="bar-flag">{FLAGS[c.code] ?? '🌍'}</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{c.country}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(c.count, maxCountry) }} />
                    </div>
                  </div>
                  <div className="bar-count">{c.count}</div>
                </div>
              ))}
            </div>

            <div className="split-card">
              <h4><span>Referrers</span><span className="placeholder-veil">Coming soon</span></h4>
              {REFERRERS.map((r) => (
                <div className="bar-row" key={r.name}>
                  <div className="bar-flag"><Globe /></div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(r.count, maxReferrer) }} />
                    </div>
                  </div>
                  <div className="bar-count">{r.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Devices & browsers */}
          <div className="split" style={{ gridTemplateColumns: '1fr' }}>
            <div className="split-card">
              <h4><span>Devices &amp; browsers</span><span className="placeholder-veil">Coming soon</span></h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 500 }}>Device</div>
                  {data?.devices.map((d) => (
                    <div className="bar-row" key={d.name}>
                      <div>{DEVICE_GLYPHS[d.name] ?? '📦'}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{d.name}</div>
                        <div className="bar-track" style={{ marginTop: '4px' }}>
                          <div className="bar-fill" style={{ width: d.pct }} />
                        </div>
                      </div>
                      <div className="bar-count">{d.pct}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 500 }}>Browser</div>
                  {data?.browsers.map((b) => (
                    <div className="bar-row" key={b.name}>
                      <div>{BROWSER_GLYPHS[b.name] ?? '🌐'}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{b.name}</div>
                        <div className="bar-track" style={{ marginTop: '4px' }}>
                          <div className="bar-fill" style={{ width: b.pct }} />
                        </div>
                      </div>
                      <div className="bar-count">{b.pct}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 500 }}>Engine · OS</div>
                  {data?.os.map((o) => (
                    <div className="bar-row" key={o.name}>
                      <div>⚙️</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{o.name}</div>
                        <div className="bar-track" style={{ marginTop: '4px' }}>
                          <div className="bar-fill" style={{ width: o.pct }} />
                        </div>
                      </div>
                      <div className="bar-count">{o.pct}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
