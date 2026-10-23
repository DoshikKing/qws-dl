import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const python = process.env.PYTHON_BIN || fileURLToPath(new URL('.runtime/venv/bin/python', root))
const result = spawnSync(python, [fileURLToPath(new URL('scripts/diagnose_qobuz.py', root)), ...process.argv.slice(2)], {
  stdio: ['ignore', 'inherit', 'inherit'],
})
if (result.error) console.error('Could not start Python. Run npm run setup:orpheus or check PYTHON_BIN.')
process.exitCode = result.status ?? 1
