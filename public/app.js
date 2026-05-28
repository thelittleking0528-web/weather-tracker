/* ═══════════════════════════════════════════════════════════════
   FORECAST DRIFT — Frontend App
   ═══════════════════════════════════════════════════════════════ */

// ─── WMO Icon + colour map ────────────────────────────────────────────────────
const WMO_INFO = {
  0:  { emoji: '☀️',  label: 'Clear Sky',            bg: 'sunny'   },
  1:  { emoji: '🌤️',  label: 'Mainly Clear',         bg: 'sunny'   },
  2:  { emoji: '⛅',  label: 'Partly Cloudy',        bg: 'clear'   },
  3:  { emoji: '☁️',  label: 'Overcast',             bg: 'clear'   },
  45: { emoji: '🌫️',  label: 'Foggy',               bg: 'clear'   },
  48: { emoji: '🌫️',  label: 'Icy Fog',             bg: 'clear'   },
  51: { emoji: '🌦️',  label: 'Light Drizzle',        bg: 'rainy'   },
  53: { emoji: '🌧️',  label: 'Drizzle',              bg: 'rainy'   },
  55: { emoji: '🌧️',  label: 'Heavy Drizzle',        bg: 'rainy'   },
  61: { emoji: '🌧️',  label: 'Light Rain',           bg: 'rainy'   },
  63: { emoji: '🌧️',  label: 'Rain',                 bg: 'rainy'   },
  65: { emoji: '🌊',  label: 'Heavy Rain',           bg: 'rainy'   },
  71: { emoji: '🌨️',  label: 'Light Snow',           bg: 'snowy'   },
  73: { emoji: '❄️',  label: 'Snow',                 bg: 'snowy'   },
  75: { emoji: '❄️',  label: 'Heavy Snow',           bg: 'snowy'   },
  77: { emoji: '🌨️',  label: 'Snow Grains',          bg: 'snowy'   },
  80: { emoji: '🌦️',  label: 'Rain Showers',         bg: 'rainy'   },
  81: { emoji: '🌦️',  label: 'Rain Showers',         bg: 'rainy'   },
  82: { emoji: '🌧️',  label: 'Heavy Showers',        bg: 'rainy'   },
  85: { emoji: '🌨️',  label: 'Snow Showers',         bg: 'snowy'   },
  86: { emoji: '❄️',  label: 'Heavy Snow Showers',   bg: 'snowy'   },
  95: { emoji: '⛈️',  label: 'Thunderstorm',         bg: 'stormy'  },
  96: { emoji: '⛈️',  label: 'Thunderstorm + Hail',  bg: 'stormy'  },
  99: { emoji: '⛈️',  label: 'Thunderstorm + Hail',  bg: 'stormy'  },
};
function wmo(code) {
  return WMO_INFO[code] ?? { emoji: '🌡️', label: `Code ${code}`, bg: 'clear' };
}

// ─── State ────────────────────────────────────────────────────────────────────
let locations     = [];
let activeLocId   = null;
let latestForecast = { snapshot_time: null, days: [] };
let trackedDates  = [];
let driftChart    = null;
let detailChart   = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const sidebar          = $('sidebar');
const sidebarBackdrop  = (() => { const d = document.createElement('div'); d.className='sidebar-backdrop'; document.body.append(d); return d; })();
const detailOverlay    = $('detailOverlay');
const detailContent    = $('detailContent');
const addLocationModal = $('addLocationModal');

// ─── Sidebar open/close ───────────────────────────────────────────────────────
function openSidebar()  { sidebar.classList.add('open'); sidebarBackdrop.classList.add('open'); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('open'); }
$('menuBtn').onclick       = openSidebar;
$('sidebarClose').onclick  = closeSidebar;
sidebarBackdrop.onclick    = closeSidebar;

// ─── Detail panel ─────────────────────────────────────────────────────────────
function openDetail()  { detailOverlay.classList.add('open'); }
function closeDetail() { detailOverlay.classList.remove('open'); if (detailChart) { detailChart.destroy(); detailChart = null; } }
$('detailClose').onclick = closeDetail;
detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeDetail(); });

// ─── Add location modal ───────────────────────────────────────────────────────
$('addLocationBtn').onclick = () => { addLocationModal.classList.add('open'); $('geocodeInput').focus(); };
$('modalClose').onclick     = () => { addLocationModal.classList.remove('open'); $('geocodeResults').innerHTML = ''; $('geocodeInput').value = ''; };
addLocationModal.addEventListener('click', e => { if (e.target === addLocationModal) $('modalClose').click(); });

$('geocodeSearch').onclick = geocodeSearch;
$('geocodeInput').onkeydown = e => { if (e.key === 'Enter') geocodeSearch(); };

async function geocodeSearch() {
  const q = $('geocodeInput').value.trim();
  if (!q) return;
  $('geocodeResults').innerHTML = '<div class="loading-state"><div class="spinner"></div>Searching…</div>';
  const results = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!results.length) { $('geocodeResults').innerHTML = '<div class="empty-state">No results found</div>'; return; }
  $('geocodeResults').innerHTML = results.map(r => `
    <div class="geo-result" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${r.name}, ${r.admin1 || ''}" data-tz="${r.timezone||'America/New_York'}">
      <div class="geo-name">${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country_code ? ', ' + r.country_code : ''}</div>
      ${r.admin2 ? `<div class="geo-sub">${r.admin2}</div>` : ''}
      <div class="geo-coords">${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</div>
    </div>
  `).join('');
  document.querySelectorAll('.geo-result').forEach(el => {
    el.onclick = async () => {
      const loc = await api('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: el.dataset.name, lat: parseFloat(el.dataset.lat), lon: parseFloat(el.dataset.lon), timezone: el.dataset.tz })
      });
      $('modalClose').click();
      await loadLocations();
      selectLocation(loc.id);
    };
  });
}

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ─── Format helpers ───────────────────────────────────────────────────────────
const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseLocalDate(str) {
  // str = 'YYYY-MM-DD' — parse as LOCAL to avoid UTC offset flipping the day
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(str) {
  const d = parseLocalDate(str);
  return `${DAY_NAMES[d.getDay()]} ${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
}
function fmtDay(str) {
  const d = parseLocalDate(str);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return DAY_NAMES[d.getDay()];
}
function fmtDateShort(str) {
  const d = parseLocalDate(str);
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function fmtCapture(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / 3600000;
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  return `${diffD}d ago`;
}
function fmtTime(hour) {
  if (hour === 0)  return '12am';
  if (hour < 12)  return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}
function fmtCaptureDate(isoStr) {
  const d = new Date(isoStr);
  return `${MON_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}
function daysOut(capturedAt, forecastDate) {
  const cap  = new Date(capturedAt); cap.setHours(0,0,0,0);
  const fore = parseLocalDate(forecastDate);
  return Math.max(0, Math.round((fore - cap) / 86400000));
}

// ─── Background theme ─────────────────────────────────────────────────────────
function setBgTheme(code) {
  const art = $('bgArt');
  art.className = 'bg-art'; // reset
  const w = wmo(code ?? 0);
  if (w.bg !== 'clear') art.classList.add(w.bg);
}

// ─── Render sidebar locations ─────────────────────────────────────────────────
function renderLocationList() {
  const list = $('locationList');
  if (!locations.length) { list.innerHTML = '<div style="font-size:12px;color:var(--text-faint);text-align:center;padding:8px 0">No locations yet</div>'; return; }
  list.innerHTML = locations.map(l => `
    <div class="loc-item ${l.id === activeLocId ? 'active' : ''}" data-id="${l.id}">
      <span class="loc-name">${l.name}</span>
      <button class="loc-delete" data-id="${l.id}" title="Remove">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.loc-item').forEach(el => {
    el.onclick = e => { if (!e.target.classList.contains('loc-delete')) { selectLocation(el.dataset.id); closeSidebar(); } };
  });
  list.querySelectorAll('.loc-delete').forEach(el => {
    el.onclick = async e => {
      e.stopPropagation();
      if (!confirm('Remove this location and all its forecast history?')) return;
      await api(`/api/locations/${el.dataset.id}`, { method: 'DELETE' });
      await loadLocations();
      if (activeLocId === el.dataset.id) {
        if (locations.length) selectLocation(locations[0].id);
        else { activeLocId = null; renderEmpty(); }
      }
    };
  });
}

// ─── Load all locations ───────────────────────────────────────────────────────
async function loadLocations() {
  locations = await api('/api/locations');
  renderLocationList();
}

// ─── Select a location ────────────────────────────────────────────────────────
async function selectLocation(id) {
  activeLocId = id;
  renderLocationList();
  const loc = locations.find(l => l.id === id);
  $('locationTitle').textContent = loc?.name ?? '—';
  $('topbarSub').textContent = '';
  await Promise.all([loadLatest(), loadTrackedDates()]);
}

// ─── Latest forecast ──────────────────────────────────────────────────────────
async function loadLatest() {
  latestForecast = await api(`/api/locations/${activeLocId}/latest`);
  renderHero();
  renderForecastStrip();
  updateSnapshotInfo();
}

function renderHero() {
  const today = latestForecast.days?.find(d => {
    const dd = parseLocalDate(d.forecast_date);
    const now = new Date(); now.setHours(0,0,0,0);
    return dd.getTime() === now.getTime();
  }) || latestForecast.days?.[0];

  if (!today) return;
  const w = wmo(today.weather_code);
  $('heroIcon').textContent = w.emoji;
  $('heroHigh').textContent = `${Math.round(today.high_temp)}°`;
  $('heroLow').textContent  = `${Math.round(today.low_temp)}°`;
  $('heroCondition').textContent = w.label;
  setBgTheme(today.weather_code);

  const peakHour = today.peak_temp_hour ?? 14;
  const sunriseStr = today.sunrise ? new Date(today.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  const sunsetStr  = today.sunset  ? new Date(today.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

  $('heroMeta').innerHTML = `
    <span>💧 ${today.precip_probability ?? '—'}%</span>
    <span>💨 ${today.wind_speed_max ? Math.round(today.wind_speed_max) + ' mph' : '—'}</span>
    <span>🕐 Peak ${fmtTime(peakHour)}</span>
    <span>🌅 ${sunriseStr}</span>
    <span>🌇 ${sunsetStr}</span>
  `;

  const snapTime = latestForecast.snapshot_time;
  $('lastUpdate').textContent = snapTime ? `Updated ${fmtCapture(snapTime)}` : '';
  $('topbarSub').textContent  = fmtDate(today.forecast_date);
}

function renderForecastStrip() {
  const strip = $('forecastStrip');
  if (!latestForecast.days?.length) { strip.innerHTML = '<div class="empty-state">No forecast data yet</div>'; return; }

  const todayStr = new Date().toISOString().split('T')[0];
  strip.innerHTML = latestForecast.days.map((d, i) => {
    const w = wmo(d.weather_code);
    const isToday = d.forecast_date === todayStr;
    const snapshotCount = trackedDates.find(t => t.forecast_date === d.forecast_date)?.snapshot_count;
    return `
      <div class="forecast-card ${isToday ? 'today' : ''}" data-date="${d.forecast_date}" title="Click for forecast history">
        <div class="fc-day">${fmtDay(d.forecast_date).toUpperCase()}</div>
        <div class="fc-icon">${w.emoji}</div>
        <div class="fc-high">${Math.round(d.high_temp)}°</div>
        <div class="fc-low">${Math.round(d.low_temp)}°</div>
        <div class="fc-precip">${d.precip_probability ? d.precip_probability + '% 💧' : ''}</div>
        ${snapshotCount > 1 ? `<div class="fc-badge">${snapshotCount}×</div>` : ''}
      </div>`;
  }).join('');

  strip.querySelectorAll('.forecast-card').forEach(el => {
    el.onclick = () => openDateDetail(el.dataset.date);
  });
}

// ─── Tracked dates calendar ───────────────────────────────────────────────────
async function loadTrackedDates() {
  trackedDates = await api(`/api/locations/${activeLocId}/tracked-dates`);
  renderCalendar();
  renderDriftOverview();
}

function renderCalendar() {
  const grid = $('calendarGrid');
  if (!trackedDates.length) { grid.innerHTML = '<div class="empty-state">Forecasts will appear here as data is collected</div>'; return; }

  const todayStr = new Date().toISOString().split('T')[0];
  // Show last 30 days + next 10 days from tracked dates
  const allDates = [...new Set(trackedDates.map(t => t.forecast_date))].sort();

  grid.innerHTML = allDates.map(dateStr => {
    const t = trackedDates.find(x => x.forecast_date === dateStr);
    const w = wmo(t?.weather_code ?? 0);
    const isToday   = dateStr === todayStr;
    const isPast    = dateStr < todayStr;
    const isFuture  = dateStr > todayStr;
    const d         = parseLocalDate(dateStr);
    const hasChange = t?.snapshot_count > 1;

    return `
      <div class="cal-cell ${isToday ? 'today-cell' : ''} ${isFuture ? '' : 'has-data'}"
           data-date="${dateStr}" title="${fmtDate(dateStr)}">
        <div class="cc-mon">${MON_NAMES[d.getMonth()]}</div>
        <div class="cc-date">${d.getDate()}</div>
        <div class="cc-icon">${w.emoji}</div>
        <div class="cc-temp">${t ? Math.round(t.high_temp) + '°' : '—'}</div>
        <div class="cc-low">${t ? Math.round(t.low_temp) + '°' : ''}</div>
        ${t?.snapshot_count > 1 ? `<div class="cc-badge">${t.snapshot_count}</div>` : ''}
        ${hasChange && isPast ? '<div class="cc-changed"></div>' : ''}
      </div>`;
  }).join('');

  grid.querySelectorAll('.cal-cell').forEach(el => {
    el.onclick = () => openDateDetail(el.dataset.date);
  });
}

// ─── Drift overview chart (last 7 tracked future dates) ──────────────────────
function renderDriftOverview() {
  const section = $('driftSection');
  const futureDates = trackedDates
    .filter(t => t.forecast_date >= new Date().toISOString().split('T')[0])
    .slice(0, 7);

  if (futureDates.length < 2) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  $('driftSub').textContent = `Latest snapshot vs. first snapshot for the next ${futureDates.length} days`;

  const canvas = $('driftChart');
  if (driftChart) { driftChart.destroy(); driftChart = null; }

  driftChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: futureDates.map(t => fmtDay(t.forecast_date)),
      datasets: [
        {
          label: 'High °F',
          data: futureDates.map(t => Math.round(t.high_temp)),
          borderColor: '#FF9F0A',
          backgroundColor: 'rgba(255,159,10,0.1)',
          pointBackgroundColor: '#FF9F0A',
          tension: 0.4, fill: true, pointRadius: 5,
        },
        {
          label: 'Low °F',
          data: futureDates.map(t => Math.round(t.low_temp)),
          borderColor: '#0A84FF',
          backgroundColor: 'rgba(10,132,255,0.08)',
          pointBackgroundColor: '#0A84FF',
          tension: 0.4, fill: true, pointRadius: 5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 }, callback: v => v + '°' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

// ─── Snapshot info ────────────────────────────────────────────────────────────
function updateSnapshotInfo() {
  const snapTime = latestForecast.snapshot_time;
  $('snapshotInfo').innerHTML = snapTime
    ? `Last captured:<br><strong>${fmtCaptureDate(snapTime)}</strong><br>Auto-updates every 3h`
    : 'No snapshots yet';
}

// ─── DATE DETAIL PANEL ────────────────────────────────────────────────────────
async function openDateDetail(dateStr) {
  openDetail();
  detailContent.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading history…</div>';
  if (detailChart) { detailChart.destroy(); detailChart = null; }

  const history = await api(`/api/locations/${activeLocId}/history/${dateStr}`);
  renderDetailPanel(dateStr, history);
}

function renderDetailPanel(dateStr, history) {
  if (!history.length) {
    detailContent.innerHTML = `
      <div class="detail-date-header">
        <div class="detail-date-label">FORECAST FOR</div>
        <div class="detail-date-big">${fmtDate(dateStr)}</div>
      </div>
      <div class="empty-state">No forecast data for this date yet.</div>`;
    return;
  }

  const latest  = history[history.length - 1];
  const first   = history[0];
  const w       = wmo(latest.weather_code);
  const today   = new Date().toISOString().split('T')[0];
  const isPast  = dateStr < today;
  const isToday = dateStr === today;

  // ── Accuracy section (only if date has passed) ──────────────────────────────
  let accuracyHTML = '';
  if (isPast && history.length >= 2) {
    const firstForecast = first;
    const lastForecast  = latest;
    const highDiff = Math.abs(Math.round(lastForecast.high_temp) - Math.round(firstForecast.high_temp));
    const lowDiff  = Math.abs(Math.round(lastForecast.low_temp)  - Math.round(firstForecast.low_temp));
    const condChanged = firstForecast.weather_code !== lastForecast.weather_code;
    const totalDrift = highDiff + lowDiff + (condChanged ? 5 : 0);
    const accuracy = Math.max(0, 100 - totalDrift * 4);
    const cls = accuracy >= 80 ? 'great' : accuracy >= 50 ? 'ok' : 'miss';
    const emoji = accuracy >= 80 ? '🎯' : accuracy >= 50 ? '🌤️' : '❌';
    accuracyHTML = `
      <div class="accuracy-banner ${cls}">
        <div class="acc-score">${emoji} ${accuracy}%</div>
        <div class="acc-label">Forecast accuracy (first → last prediction)<br>
          High drifted ${highDiff}°, Low drifted ${lowDiff}°${condChanged ? ', condition changed' : ''}</div>
      </div>`;
  }

  // ── Latest summary card ──────────────────────────────────────────────────────
  const peakHour = latest.peak_temp_hour ?? 14;
  const sunriseStr = latest.sunrise ? new Date(latest.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  const sunsetStr  = latest.sunset  ? new Date(latest.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

  // ── Build change timeline ────────────────────────────────────────────────────
  const timelineItems = history.map((snap, i) => {
    const prev = i > 0 ? history[i - 1] : null;
    const ws = wmo(snap.weather_code);
    const changes = [];

    if (prev) {
      const highDelta = Math.round(snap.high_temp) - Math.round(prev.high_temp);
      const lowDelta  = Math.round(snap.low_temp)  - Math.round(prev.low_temp);
      const precipDelta = (snap.precip_probability || 0) - (prev.precip_probability || 0);

      if (highDelta !== 0) changes.push({ dir: highDelta > 0 ? 'up' : 'down', text: `High ${highDelta > 0 ? '+' : ''}${highDelta}°` });
      if (lowDelta  !== 0) changes.push({ dir: lowDelta  > 0 ? 'up' : 'down', text: `Low ${lowDelta > 0 ? '+' : ''}${lowDelta}°` });
      if (snap.weather_code !== prev.weather_code) changes.push({ dir: 'cond', text: `${wmo(prev.weather_code).emoji} → ${ws.emoji}` });
      if (Math.abs(precipDelta) >= 5) changes.push({ dir: precipDelta > 0 ? 'up' : 'down', text: `Rain ${precipDelta > 0 ? '+' : ''}${precipDelta}%` });
    }

    const dOut = daysOut(snap.captured_at, dateStr);
    const dOutLabel = dOut === 0 ? 'Day of' : dOut === 1 ? '1 day out' : `${dOut} days out`;

    return `
      <div class="timeline-item ${changes.length ? 'changed' : ''}">
        <div class="ti-when">${fmtCaptureDate(snap.captured_at)}<br><span style="color:var(--text-faint);font-size:10px">${dOutLabel}</span></div>
        <div class="ti-icon">${ws.emoji}</div>
        <div class="ti-right">
          <div class="ti-condition">${ws.label}</div>
          <div class="ti-temps">High ${Math.round(snap.high_temp)}° · Low ${Math.round(snap.low_temp)}° · 💧${snap.precip_probability ?? 0}%</div>
          ${changes.length ? `
            <div class="ti-changes">
              ${changes.map(c => `<span class="change-pill ${c.dir}">${c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '⚡'} ${c.text}</span>`).join('')}
            </div>` : (i > 0 ? '<div style="font-size:11px;color:var(--text-faint);margin-top:4px">No change from previous snapshot</div>' : '')}
        </div>
      </div>`;
  }).reverse().join(''); // show newest first

  // ── Hourly strip for latest snapshot ─────────────────────────────────────────
  let hourlyHTML = '';
  if (latest.hourly_temps?.length) {
    const hours = latest.hourly_temps.map((temp, h) => {
      const code = latest.hourly_codes?.[h] ?? 0;
      const precip = latest.hourly_precip?.[h] ?? 0;
      return `
        <div class="hour-cell">
          <div class="hc-time">${fmtTime(h)}</div>
          <div class="hc-icon">${wmo(code).emoji}</div>
          <div class="hc-temp">${Math.round(temp)}°</div>
          <div class="hc-precip">${precip > 0 ? precip + '%' : ''}</div>
        </div>`;
    }).join('');
    hourlyHTML = `
      <div class="detail-section-title">HOURLY BREAKDOWN (LATEST SNAPSHOT)</div>
      <div class="hourly-strip" style="margin-bottom:20px">${hours}</div>`;
  }

  // ── Drift chart data ──────────────────────────────────────────────────────────
  const chartId = 'detailDriftChart';

  detailContent.innerHTML = `
    <div class="detail-date-header">
      <div class="detail-date-label">FORECAST FOR</div>
      <div class="detail-date-big">${fmtDate(dateStr)}</div>
    </div>

    ${accuracyHTML}

    <div class="detail-latest-card">
      <div class="dlc-icon">${w.emoji}</div>
      <div class="dlc-right">
        <div class="dlc-condition">${w.label} <span style="color:var(--text-faint);font-size:12px">(latest snapshot)</span></div>
        <div class="dlc-temps">
          <span class="dlc-high">${Math.round(latest.high_temp)}°</span>
          <span class="dlc-low">/ ${Math.round(latest.low_temp)}°</span>
        </div>
        <div class="dlc-meta">
          <span>💧 ${latest.precip_probability ?? 0}%</span>
          <span>💨 ${latest.wind_speed_max ? Math.round(latest.wind_speed_max) + ' mph' : '—'}</span>
          <span>🔆 UV ${latest.uv_index_max ?? '—'}</span>
          <span>🕐 Peak ~${fmtTime(peakHour)}</span>
          <span>🌅 ${sunriseStr}</span>
        </div>
      </div>
    </div>

    ${history.length > 1 ? `
    <div class="detail-section-title">${history.length} SNAPSHOTS — TEMPERATURE DRIFT</div>
    <div class="detail-chart-wrap" style="margin-bottom:20px">
      <canvas id="${chartId}"></canvas>
    </div>` : ''}

    ${hourlyHTML}

    <div class="detail-section-title">FULL SNAPSHOT HISTORY (${history.length} captures)</div>
    <div class="history-timeline">${timelineItems}</div>
  `;

  // Render drift chart inside detail
  if (history.length > 1) {
    const canvas = document.getElementById(chartId);
    if (detailChart) { detailChart.destroy(); detailChart = null; }
    detailChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.map(s => fmtCaptureDate(s.captured_at)),
        datasets: [
          {
            label: 'Forecasted High',
            data: history.map(s => Math.round(s.high_temp)),
            borderColor: '#FF9F0A', backgroundColor: 'rgba(255,159,10,0.12)',
            pointBackgroundColor: '#FF9F0A',
            tension: 0.4, fill: false, pointRadius: 4,
          },
          {
            label: 'Forecasted Low',
            data: history.map(s => Math.round(s.low_temp)),
            borderColor: '#0A84FF', backgroundColor: 'rgba(10,132,255,0.08)',
            pointBackgroundColor: '#0A84FF',
            tension: 0.4, fill: false, pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 }, maxRotation: 30 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 }, callback: v => v + '°' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  }
}

// ─── Refresh button ───────────────────────────────────────────────────────────
$('refreshBtn').onclick = async () => {
  const btn = $('refreshBtn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await api('/api/snapshot', { method: 'POST' });
    await Promise.all([loadLatest(), loadTrackedDates()]);
  } catch (e) {
    console.error(e);
  }
  btn.classList.remove('spinning');
  btn.disabled = false;
};

// ─── Empty state ──────────────────────────────────────────────────────────────
function renderEmpty() {
  $('locationTitle').textContent = 'No location';
  $('heroIcon').textContent = '🌍';
  $('heroHigh').textContent = '—°';
  $('heroLow').textContent  = '—°';
  $('heroCondition').textContent = 'Add a location to start tracking';
  $('heroMeta').innerHTML = '';
  $('forecastStrip').innerHTML = '';
  $('calendarGrid').innerHTML = '';
  $('driftSection').style.display = 'none';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadLocations();
  if (locations.length) {
    await selectLocation(locations[0].id);
  } else {
    renderEmpty();
  }
}

init();
