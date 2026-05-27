-- Weather Tracker Schema
-- Run this in your Supabase SQL editor (supabase.ry-server.com)

-- ─── Locations ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  lat         DECIMAL(9,6) NOT NULL,
  lon         DECIMAL(9,6) NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'America/New_York',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Daily Forecast Snapshots ──────────────────────────────────────────────────
-- Each row = one forecast for one date, as seen at captured_at
CREATE TABLE IF NOT EXISTS daily_forecasts (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  captured_at         TIMESTAMPTZ NOT NULL,   -- when we queried the API
  forecast_date       DATE NOT NULL,           -- which day this forecast is for
  high_temp           DECIMAL(5,2),
  low_temp            DECIMAL(5,2),
  weather_code        SMALLINT,
  precip_probability  SMALLINT,               -- 0-100 %
  wind_speed_max      DECIMAL(5,2),           -- mph
  uv_index_max        DECIMAL(4,2),
  sunrise             TEXT,
  sunset              TEXT,
  peak_temp_hour      SMALLINT,               -- 0-23
  hourly_temps        JSONB,                  -- array[24] °F
  hourly_codes        JSONB,                  -- array[24] WMO codes
  hourly_precip       JSONB,                  -- array[24] precip %
  hourly_wind         JSONB,                  -- array[24] mph
  hourly_apparent     JSONB,                  -- array[24] feels-like °F

  UNIQUE (location_id, captured_at, forecast_date)
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_df_location_date
  ON daily_forecasts (location_id, forecast_date);

CREATE INDEX IF NOT EXISTS idx_df_location_captured
  ON daily_forecasts (location_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_df_captured
  ON daily_forecasts (captured_at DESC);

-- ─── Seed: default location (Ronkonkoma, NY) ──────────────────────────────────
INSERT INTO locations (name, lat, lon, timezone)
VALUES ('Ronkonkoma, NY', 40.8234, -73.1129, 'America/New_York')
ON CONFLICT DO NOTHING;
