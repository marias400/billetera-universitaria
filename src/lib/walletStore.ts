import { openDB } from 'idb'
import type { SignedCredential } from './credentialCrypto'

const database = openDB('unlar-wallet', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('credentials', { keyPath: 'id' })
    if (oldVersion < 2) db.createObjectStore('keys')
  },
})

export type WalletCredential = SignedCredential & { localStatus: 'Activa' | 'Revocada' }

export async function listWalletCredentials() {
  return (await database).getAll('credentials') as Promise<WalletCredential[]>
}

export async function storeWalletCredential(credential: SignedCredential) {
  const db = await database
  const current = await db.get('credentials', credential.id) as WalletCredential | undefined
  await db.put('credentials', { ...credential, localStatus: current?.localStatus ?? 'Activa' })
}

export async function updateWalletCredentialStatus(id: string, status: 'Activa' | 'Revocada') {
  const db = await database
  const current = await db.get('credentials', id) as WalletCredential | undefined
  if (current) await db.put('credentials', { ...current, localStatus: status })
}

export async function getWalletKeyPair() {
  return (await database).get('keys', 'holder-key-pair') as Promise<CryptoKeyPair | undefined>
}

export async function storeWalletKeyPair(pair: CryptoKeyPair) {
  await (await database).put('keys', pair, 'holder-key-pair')
}
