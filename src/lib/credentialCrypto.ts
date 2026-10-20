import { getWalletKeyPair, storeWalletKeyPair } from './walletStore'

export type CredentialPayload = {
  id: string
  type: string
  issuer: string
  holder: string
  claims: Record<string, string>
  issuedAt: string
  expiresAt?: string
}

export type SignedCredential = CredentialPayload & {
  proof: { algorithm: 'Ed25519'; verificationMethod: string; signature: string }
}

const encoder = new TextEncoder()

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function canonicalize(value: CredentialPayload) {
  return JSON.stringify({ claims: value.claims, expiresAt: value.expiresAt, holder: value.holder, id: value.id, issuedAt: value.issuedAt, issuer: value.issuer, type: value.type })
}

export async function verifyCredential(credential: SignedCredential, publicKeyPem: string) {
  try {
    if (credential.proof.algorithm !== 'Ed25519') return false
    const body = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
    const binary = Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
    const publicKey = await crypto.subtle.importKey('spki', binary, { name: 'Ed25519' }, false, ['verify'])
    const { proof, ...payload } = credential
    return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, base64UrlToBytes(proof.signature), encoder.encode(canonicalize(payload)))
  } catch { return false }
}

async function getWalletKeys() {
  const existing = await getWalletKeyPair()
  if (existing) return existing
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  await storeWalletKeyPair(pair)
  return pair
}

export async function signWalletProof(message: string) {
  const keys = await getWalletKeys()
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, encoder.encode(message))
  const publicKey = await crypto.subtle.exportKey('spki', keys.publicKey)
  return { walletPublicKey: bytesToBase64(new Uint8Array(publicKey)), holderSignature: bytesToBase64Url(new Uint8Array(signature)) }
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
