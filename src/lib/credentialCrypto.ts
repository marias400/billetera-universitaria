import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
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
  proof: { algorithm: 'ML-DSA-65'; verificationMethod: string; signature: string }
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
    if (credential.proof.algorithm !== 'ML-DSA-65') return false
    const publicKey = Uint8Array.from(atob(publicKeyPem), (character) => character.charCodeAt(0))
    const { proof, ...payload } = credential
    return ml_dsa65.verify(base64UrlToBytes(proof.signature), encoder.encode(canonicalize(payload)), publicKey)
  } catch { return false }
}

async function getWalletKeys() {
  const existing = await getWalletKeyPair()
  if (existing) return existing
  const pair = ml_dsa65.keygen()
  await storeWalletKeyPair(pair)
  return pair
}

export async function signWalletProof(message: string) {
  const keys = await getWalletKeys()
  const signature = ml_dsa65.sign(encoder.encode(message), keys.secretKey)
  return { walletPublicKey: bytesToBase64(keys.publicKey), holderSignature: bytesToBase64Url(signature) }
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
