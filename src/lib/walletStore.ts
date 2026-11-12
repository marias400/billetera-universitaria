import { openDB } from 'idb'
import type { SignedCredential } from './credentialCrypto'

const database = openDB('unlar-wallet', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('credentials', { keyPath: 'id' })
    if (oldVersion < 2) db.createObjectStore('keys')
  },
})

export type WalletCredential = SignedCredential & { localStatus: 'Activa' | 'Revocada' | 'No registrada' }

export async function listWalletCredentials() {
  return (await database).getAll('credentials') as Promise<WalletCredential[]>
}

export async function clearWalletCredentials() {
  await (await database).clear('credentials')
}

export async function removeWalletCredential(id: string) {
  await (await database).delete('credentials', id)
}

export async function storeWalletCredential(credential: SignedCredential) {
  const db = await database
  const current = await db.get('credentials', credential.id) as WalletCredential | undefined
  await db.put('credentials', { ...credential, localStatus: current?.localStatus ?? 'Activa' })
}

export async function updateWalletCredentialStatus(id: string, status: WalletCredential['localStatus']) {
  const db = await database
  const current = await db.get('credentials', id) as WalletCredential | undefined
  if (current) await db.put('credentials', { ...current, localStatus: status })
}

export async function getWalletKeyPair() {
  return (await database).get('keys', 'holder-ml-dsa-65-key-pair') as Promise<{ publicKey: Uint8Array; secretKey: Uint8Array } | undefined>
}

export async function storeWalletKeyPair(pair: { publicKey: Uint8Array; secretKey: Uint8Array }) {
  await (await database).put('keys', pair, 'holder-ml-dsa-65-key-pair')
}
