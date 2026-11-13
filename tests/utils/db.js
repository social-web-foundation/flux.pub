import { Sequelize } from 'sequelize'
import { runMigrations } from '@evanp/activitypub-bot/lib/migrations/index.js'

const SQLITE_MEMORY_URL = 'sqlite::memory:'
const SQLITE_MEMORY_ALIASES = new Set([
  'sqlite::memory',
  SQLITE_MEMORY_URL,
  ':sqlite::memory:',
  ':sqllite::memory:'
])

export function getTestDatabaseUrl () {
  const databaseUrl = process.env.TEST_DATABASE_URL || SQLITE_MEMORY_URL
  return SQLITE_MEMORY_ALIASES.has(databaseUrl) ? SQLITE_MEMORY_URL : databaseUrl
}

export async function cleanupTestDatabase (scope = {}) {
  const databaseUrl = getTestDatabaseUrl()
  if (databaseUrl === SQLITE_MEMORY_URL) return
  
  const connection = new Sequelize(databaseUrl, { logging: false })
  try {
    await connection.authenticate()
    await runMigrations(connection)
    // Clear all tables in reverse dependency order
    const tables = [
      'actorcollectionpage', 'actorcollection', 'lastactivity', 'botdata',
      'new_keys', 'new_remotekeys', 'pages', 'collections', 'objects', 
      'endpoint_cache', 'server_stats', 'rate_limit', 'remote_object_cache', 
      'signature_policy', 'job', 'failed_job', 'actoroutbox', 'domain_block'
    ]
    for (const table of tables) {
      try {
        await connection.query(`DELETE FROM "${table}"`)
      } catch (err) {
        // Table might not exist yet, ignore
      }
    }
  } finally {
    await connection.close()
  }
}
