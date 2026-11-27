export type DraftScope = [issuer: string, clientId: string, subject: string, eventId: string];

export interface RequestDraft<Fields> {
  revision: string;
  fields: Fields;
  submission?: { body: string; key: string };
}

const storeName = 'request-drafts';

export class DraftChangedError extends Error {
  constructor() {
    super('The saved draft changed in another tab. Reopen it before continuing.');
  }
}

function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rebuild', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDraft<Fields>(scope: DraftScope): Promise<RequestDraft<Fields> | undefined> {
  const database = await openDrafts();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).get(scope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function writeDraft<Fields>(
  scope: DraftScope,
  expectedRevision: string | undefined,
  draft?: RequestDraft<Fields>,
): Promise<void> {
  const database = await openDrafts();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(scope);
      request.onsuccess = () => {
        if (request.result?.revision !== expectedRevision) {
          reject(new DraftChangedError());
          transaction.abort();
        } else if (draft) {
          store.put(draft, scope);
        } else {
          store.delete(scope);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
