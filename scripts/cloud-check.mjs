// Build and unit checks without production credentials or database access.
import { spawnSync } from 'node:child_process'

const env = { ...process.env }
for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'GITHUB_MODELS_TOKEN', 'INTEGRATION_CLIENTS_JSON', 'PAINEL_TOKEN']) delete env[key]
env.NEXT_PUBLIC_SUPABASE_URL = 'https://development.invalid'
env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'development-placeholder-not-a-real-key'
env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
env.NEXT_TELEMETRY_DISABLED = '1'

for (const script of ['test:integrations', 'build']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    env, stdio: 'inherit', shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
