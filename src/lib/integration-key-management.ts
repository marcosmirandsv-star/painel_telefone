import { randomBytes, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './integration-server.ts'

export const KEY_PUBLIC_FIELDS = 'id,name,prefix,channels,created_at,expires_at,revoked_at'
export function validateKeyInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Informe os dados da chave.')
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(k => !['name', 'channels', 'validity_days'].includes(k))) throw new ApiError(400, 'Campo desconhecido.')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 3 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, 'Informe o nome do sistema destinatário, entre 3 e 80 caracteres.')
  if (!Array.isArray(body.channels) || !body.channels.length || body.channels.length > 2 || body.channels.some(c => c !== 'telefone' && c !== 'chat')) throw new ApiError(400, 'Selecione Telefone, Chat ou ambos.')
  if (new Set(body.channels).size !== body.channels.length) throw new ApiError(400, 'Canal repetido.')
  if (![30, 90, 180, 365].includes(Number(body.validity_days)) || typeof body.validity_days !== 'number') throw new ApiError(400, 'Escolha uma validade de 30, 90, 180 ou 365 dias.')
  return { name, channels: body.channels as ('telefone' | 'chat')[], validityDays: body.validity_days as number }
}
export async function createIntegrationKey(admin: SupabaseClient, userId: string, input: unknown) {
  const values = validateKeyInput(input)
  const token = `cp_${randomBytes(32).toString('base64url')}`
  const { data, error } = await admin.from('integration_keys').insert({
    name: values.name, channels: values.channels,
    token_hash: createHash('sha256').update(token).digest('hex'),
    prefix: token.slice(0, 11), created_by: userId,
    expires_at: new Date(Date.now() + values.validityDays * 86400000).toISOString(),
  }).select(KEY_PUBLIC_FIELDS).single()
  if (error || !data) throw new ApiError(503, 'Não foi possível gerar a chave. Atualize a lista antes de tentar novamente.')
  // The raw secret is returned only here, never stored or included in list results.
  return { key: data, token }
}
export async function listIntegrationKeys(admin: SupabaseClient, page: number) {
  const offset = (page - 1) * 25
  const { data, error } = await admin.from('integration_keys').select(KEY_PUBLIC_FIELDS)
    .order('created_at', { ascending: false }).order('id').range(offset, offset + 25)
  if (error) throw new ApiError(503, 'Não foi possível carregar as chaves.')
  return { keys: (data ?? []).slice(0, 25), hasMore: (data?.length ?? 0) > 25 }
}
export async function revokeIntegrationKey(admin: SupabaseClient, userId: string, id: unknown) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new ApiError(400, 'Identificador da chave inválido.')
  const result = await admin.from('integration_keys').update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('id', id).is('revoked_at', null).select(KEY_PUBLIC_FIELDS).maybeSingle()
  if (result.error) throw new ApiError(503, 'Não foi possível revogar a chave.')
  if (result.data) return { key: result.data }
  // Repeated revocation is safe and preserves the original audit information.
  const existing = await admin.from('integration_keys').select(KEY_PUBLIC_FIELDS).eq('id', id).maybeSingle()
  if (existing.error) throw new ApiError(503, 'Não foi possível consultar a chave.')
  if (!existing.data) throw new ApiError(404, 'Chave não encontrada.')
  return { key: existing.data }
}
