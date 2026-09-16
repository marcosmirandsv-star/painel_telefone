import { randomBytes, createHash } from 'node:crypto'
const id = process.argv[2]
if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
  console.error('Uso: node scripts/create-integration-key.mjs projetos')
  process.exit(1)
}
const token = randomBytes(32).toString('base64url')
console.log('Credencial secreta: entregue somente ao responsável pela plataforma consumidora.\n' + token)
console.log('\nEntrada para INTEGRATION_CLIENTS_JSON (ajuste validade e canais):')
console.log(JSON.stringify([{ id, sha256: createHash('sha256').update(token).digest('hex'), expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), channels: ['telefone', 'chat'] }]))
