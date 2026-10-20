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
  proof: {
    algorithm: 'Ed25519'
    verificationMethod: string
    signature: string
  }
}

const encoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function canonicalize(value: CredentialPayload) {
  return JSON.stringify({
    claims: value.claims,
    expiresAt: value.expiresAt,
    holder: value.holder,
    id: value.id,
    issuedAt: value.issuedAt,
    issuer: value.issuer,
    type: value.type,
  })
}

async function getIssuerKeys() {
  const saved = localStorage.getItem('unidemo.issuer-key-pair')
  if (saved) {
    const pair = JSON.parse(saved) as { publicKey: JsonWebKey; privateKey: JsonWebKey }
    return {
      privateKey: await crypto.subtle.importKey('jwk', pair.privateKey, { name: 'Ed25519' }, true, ['sign']),
      publicKey: await crypto.subtle.importKey('jwk', pair.publicKey, { name: 'Ed25519' }, true, ['verify']),
      keyId: pair.publicKey.x ?? 'issuer-key',
    }
  }

  const generated = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', generated.publicKey)
  const privateKey = await crypto.subtle.exportKey('jwk', generated.privateKey)
  localStorage.setItem('unidemo.issuer-key-pair', JSON.stringify({ publicKey, privateKey }))
  return { privateKey: generated.privateKey, publicKey: generated.publicKey, keyId: publicKey.x ?? 'issuer-key' }
}

export async function signCredential(payload: CredentialPayload): Promise<SignedCredential> {
  const keys = await getIssuerKeys()
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, encoder.encode(canonicalize(payload)))
  return {
    ...payload,
    proof: {
      algorithm: 'Ed25519',
      verificationMethod: 'did:key:' + keys.keyId.slice(0, 18),
      signature: bytesToBase64Url(new Uint8Array(signature)),
    },
  }
}

export async function verifyCredential(credential: SignedCredential) {
  const keys = await getIssuerKeys()
  const { proof, ...payload } = credential
  if (proof.algorithm !== 'Ed25519') return false
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    keys.publicKey,
    base64UrlToBytes(proof.signature),
    encoder.encode(canonicalize(payload)),
  )
}
