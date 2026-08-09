# agenda.delivery — Dev Startup
# Starts Docker (Postgres), applies migrations, seeds DB, and launches Next.js dev server.

Write-Host "Starting agenda.delivery dev environment..." -ForegroundColor Green

# 1. Start Docker (Postgres)
Write-Host "`n[1/4] Starting Docker containers..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker failed to start. Is Docker Desktop running?" -ForegroundColor Red
    exit 1
}

# Wait for Postgres to be ready
Write-Host "[2/4] Waiting for Postgres..." -ForegroundColor Cyan
$retries = 0
do {
    $ready = docker exec agenda-db pg_isready -U agenda 2>$null
    if ($ready -match "accepting") { break }
    $retries++
    Start-Sleep -Seconds 2
} while ($retries -lt 10)
if ($retries -ge 10) {
    Write-Host "Postgres not ready after 20s" -ForegroundColor Red
    exit 1
}
Write-Host "  Postgres is ready." -ForegroundColor Green

# 3. Apply migrations + seed
Write-Host "[3/4] Applying migrations..." -ForegroundColor Cyan
npx drizzle-kit migrate --quiet
Write-Host "  Migrations applied." -ForegroundColor Green

Write-Host "  Seeding sample modules (only if not present)..." -ForegroundColor Cyan
npm run db:seed --silent
Write-Host "  Done. Existing modules were left untouched." -ForegroundColor Green

# 4. Start Next.js dev server
Write-Host "[4/4] Starting Next.js dev server..." -ForegroundColor Cyan
Write-Host "  -> http://localhost:3000" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop.`n" -ForegroundColor DarkGray

npx next dev