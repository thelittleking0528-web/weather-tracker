import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WMO Weather Code Metadata ───────────────────────────────────────────────
export const WMO = {
  0:  { label: 'Clear Sky',             icon: 'clear',       severity: 0 },
  1:  { label: 'Mainly Clear',          icon: 'mainly-clear',severity: 0 },
  2:  { label: 'Partly Cloudy',         icon: 'partly-cloudy',severity: 1 },
  3:  { label: 'Overcast',              icon: 'cloudy',      severity: 1 },
  45: { label: 'Foggy',                 icon: 'fog',         severity: 2 },
  48: { label: 'Icy Fog',               icon: 'fog',         severity: 2 },
  51: { label: 'Light Drizzle',         icon: 'drizzle',     severity: 2 },
  53: { label: 'Drizzle',               icon: 'drizzle',     severity: 2 },
  55: { label: 'Heavy Drizzle',         icon: 'drizzle',     severity: 3 },
  61: { label: 'Light Rain',            icon: 'rain',        severity: 3 },
  63: { label: 'Rain',                  icon: 'rain',        severity: 3 },
  65: { label: 'Heavy Rain',            icon: 'rain-heavy',  severity: 4 },
  71: { label: 'Light Snow',            icon: 'snow',        severity: 3 },
  73: { label: 'Snow',                  icon: 'snow',        severity: 3 },
  75: { label: 'Heavy Snow',            icon: 'snow-heavy',  severity: 4 },
  77: { label: 'Snow Grains',           icon: 'snow',        severity: 2 },
  80: { label: 'Rain Showers',          icon: 'rain',        severity: 3 },
  81: { label: 'Rain Showers',          icon: 'rain',        severity: 3 },
  82: { label: 'Heavy Showers',         icon: 'rain-heavy',  severity: 4 },
  85: { label: 'Snow Showers',          icon: 'snow',        severity: 3 },
  86: { label: 'Heavy Snow Showers',    icon: 'snow-heavy',  severity: 4 },
  95: { label: 'Thunderstorm',          icon: 'thunder',     severity: 5 },
  96: { label: 'Thunderstorm + Hail',   icon: 'thunder',     severity: 5 },
  99: { label: 'Thunderstorm + Hail',   icon: 'thunder',     severity: 5 },
};

// ─── Core Fetch ───────────────────────────────────────────────────────────────
async function fetchWeatherForLocation(location) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m,apparent_temperature` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,uv_index_max` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch` +
    `&timezone=${encodeURIComponent(location.timezone)}&forecast_days=10`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  return res.json();
}

async function runSnapshot() {
  console.log(`[${new Date().toISOString()}] Running forecast snapshot…`);

  const { data: locations, error } = await supabase.from('locations').select('*');
  if (error) { console.error('Supabase error fetching locations:', error.message); return; }
  if (!locations.length) { console.log('No locations configured yet.'); return; }

  for (const loc of locations) {
    try {
      const wx = await fetchWeatherForLocation(loc);
      const capturedAt = new Date().toISOString();
      const rows = [];

      for (let i = 0; i < wx.daily.time.length; i++) {
        const dayStart = i * 24;
        const hourlyTemps       = wx.hourly.temperature_2m.slice(dayStart, dayStart + 24);
        const hourlyCodes       = wx.hourly.weathercode.slice(dayStart, dayStart + 24);
        const hourlyPrecip      = wx.hourly.precipitation_probability.slice(dayStart, dayStart + 24);
        const hourlyWind        = wx.hourly.windspeed_10m.slice(dayStart, dayStart + 24);
        const hourlyApparent    = wx.hourly.apparent_temperature.slice(dayStart, dayStart + 24);

        const maxTempVal = Math.max(...hourlyTemps.filter(t => t !== null));
        const peakTempHour = hourlyTemps.indexOf(maxTempVal);

        rows.push({
          location_id:       loc.id,
          captured_at:       capturedAt,
          forecast_date:     wx.daily.time[i],
          high_temp:         wx.daily.temperature_2m_max[i],
          low_temp:          wx.daily.temperature_2m_min[i],
          weather_code:      wx.daily.weathercode[i],
          precip_probability:wx.daily.precipitation_probability_max[i],
          wind_speed_max:    wx.daily.windspeed_10m_max[i],
          uv_index_max:      wx.daily.uv_index_max?.[i] ?? null,
          sunrise:           wx.daily.sunrise[i],
          sunset:            wx.daily.sunset[i],
          peak_temp_hour:    peakTempHour,
          hourly_temps:      hourlyTemps,
          hourly_codes:      hourlyCodes,
          hourly_precip:     hourlyPrecip,
          hourly_wind:       hourlyWind,
          hourly_apparent:   hourlyApparent,
        });
      }

      const { error: upsertErr } = await supabase
        .from('daily_forecasts')
        .upsert(rows, { onConflict: 'location_id,captured_at,forecast_date' });

      if (upsertErr) console.error(`Upsert error for ${loc.name}:`, upsertErr.message);
      else console.log(`  ✓ ${loc.name}: ${rows.length} days saved`);

    } catch (err) {
      console.error(`  ✗ ${loc.name}:`, err.message);
    }
  }
}

// ─── API Routes ──────────────────────────────────────────────────────

// List all locations
app.get('/api/locations', async (_req, res) => {
  const { data, error } = await supabase.from('locations').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add a location (geocodes via Open-Meteo geocoding)
app.post('/api/locations', async (req, res) => {
  const { name, lat, lon, timezone = 'America/New_York' } = req.body;
  if (!name || lat == null || lon == null) {
    return res.status(400).json({ error: 'name, lat, and lon are required' });
  }

  const { data, error } = await supabase
    .from('locations')
    .insert([{ name, lat, lon, timezone }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Immediately snapshot for the new location
  try {
    const wx = await fetchWeatherForLocation(data);
    const capturedAt = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < wx.daily.time.length; i++) {
      const dayStart = i * 24;
      rows.push({
        location_id:       data.id,
        captured_at:       capturedAt,
        forecast_date:     wx.daily.time[i],
        high_temp:         wx.daily.temperature_2m_max[i],
        low_temp:          wx.daily.temperature_2m_min[i],
        weather_code:      wx.daily.weathercode[i],
        precip_probability:wx.daily.precipitation_probability_max[i],
        wind_speed_max:    wx.daily.windspeed_10m_max[i],
        uv_index_max:      wx.daily.uv_index_max?.[i] ?? null,
        sunrise:           wx.daily.sunrise[i],
        sunset:            wx.daily.sunset[i],
        peak_temp_hour:    wx.hourly.temperature_2m.slice(dayStart, dayStart + 24)
                              .indexOf(Math.max(...wx.hourly.temperature_2m.slice(dayStart, dayStart + 24))),
        hourly_temps:      wx.hourly.temperature_2m.slice(dayStart, dayStart + 24),
        hourly_codes:      wx.hourly.weathercode.slice(dayStart, dayStart + 24),
        hourly_precip:     wx.hourly.precipitation_probability.slice(dayStart, dayStart + 24),
        hourly_wind:       wx.hourly.windspeed_10m.slice(dayStart, dayStart + 24),
        hourly_apparent:   wx.hourly.apparent_temperature.slice(dayStart, dayStart + 24),
      });
    }
    await supabase.from('daily_forecasts').upsert(rows, { onConflict: 'location_id,captured_at,forecast_date' });
  } catch (e) {
    console.error('Initial snapshot failed:', e.message);
  }

  res.json(data);
});

// Delete a location
app.delete('/api/locations/:id', async (req, res) => {
  await supabase.from('daily_forecasts').delete().eq('location_id', req.params.id);
  const { error } = await supabase.from('locations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Latest 10-day forecast snapshot for a location
app.get('/api/locations/:id/latest', async (req, res) => {
  const { data: newest } = await supabase
    .from('daily_forecasts')
    .select('captured_at')
    .eq('location_id', req.params.id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!newest) return res.json([]);

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('daily_forecasts')
    .select('*')
    .eq('location_id', req.params.id)
    .eq('captured_at', newest.captured_at)
    .gte('forecast_date', today)
    .order('forecast_date');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ snapshot_time: newest.captured_at, days: data });
});

// Full forecast history for ONE target date (all captures)
app.get('/api/locations/:id/history/:date', async (req, res) => {
  const { data, error } = await supabase
    .from('daily_forecasts')
    .select('*')
    .eq('location_id', req.params.id)
    .eq('forecast_date', req.params.date)
    .order('captured_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// All unique forecast dates that have been tracked (for calendar)
app.get('/api/locations/:id/tracked-dates', async (req, res) => {
  const { data, error } = await supabase
    .from('daily_forecasts')
    .select('forecast_date, high_temp, low_temp, weather_code, precip_probability, captured_at')
    .eq('location_id', req.params.id)
    .order('forecast_date')
    .order('captured_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const byDate = {};
  for (const row of data) {
    if (!byDate[row.forecast_date]) byDate[row.forecast_date] = row;
  }

  const counts = {};
  for (const row of data) {
    counts[row.forecast_date] = (counts[row.forecast_date] || 0) + 1;
  }

  const result = Object.values(byDate).map(r => ({
    ...r,
    snapshot_count: counts[r.forecast_date] || 1,
  }));

  res.json(result);
});

// Geocode search for adding locations
app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q param required' });

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const r = await fetch(url);
  const d = await r.json();
  res.json(d.results || []);
});

// Manual snapshot trigger
app.post('/api/snapshot', async (_req, res) => {
  await runSnapshot();
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/wmo', (_req, res) => res.json(WMO));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

cron.schedule('0 */3 * * *', runSnapshot);
setTimeout(runSnapshot, 5000);

app.listen(PORT, () => {
  console.log(`Weather Tracker running on :${PORT}`);
});
