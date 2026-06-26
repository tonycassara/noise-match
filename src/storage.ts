import type { MatchConfig, SavedTemplate } from './matchState'

const DB_NAME = 'noise-match'
const DB_VERSION = 1
const STORE_NAME = 'workspace'

type StoreShape = {
  currentConfig?: MatchConfig
  autosaves?: MatchConfig[]
  templates?: SavedTemplate[]
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readValue<Key extends keyof StoreShape>(key: Key): Promise<StoreShape[Key]> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)

    request.onsuccess = () => resolve(request.result as StoreShape[Key])
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function writeValue<Key extends keyof StoreShape>(
  key: Key,
  value: StoreShape[Key],
): Promise<void> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const request = tx.objectStore(STORE_NAME).put(value, key)

    request.onerror = () => reject(request.error)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadWorkspace() {
  const [currentConfig, autosaves, templates] = await Promise.all([
    readValue('currentConfig'),
    readValue('autosaves'),
    readValue('templates'),
  ])

  return {
    currentConfig,
    autosaves: autosaves ?? [],
    templates: templates ?? [],
  }
}

export function saveCurrentConfig(config: MatchConfig) {
  return writeValue('currentConfig', config)
}

export function saveAutosaves(autosaves: MatchConfig[]) {
  return writeValue('autosaves', autosaves)
}

export function saveTemplates(templates: SavedTemplate[]) {
  return writeValue('templates', templates)
}
