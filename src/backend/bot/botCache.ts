import { db } from '../db/firestore';

export interface SourceInfo {
  book: string;
  page: number;
  pages?: number[];
  imageUrl: string;
  targetText?: string;
  query?: string;
}

export const ongoingStreams = new Map<string, AbortController>();
export const userToBotMsgMap = new Map<string, number>();
export const sourceUploadCache = new Map<string, { chatId: string, messageIds: number[] }>();

export const sourceCache = new Map<string, SourceInfo>();
export const groupCache = new Map<string, SourceInfo[]>();

/**
 * Firestore-бағытталған кэшті қолдау үшін көмекші функциялар (Stateless контейнерде жоғалмауы үшін)
 */
export async function getSourceInfo(id: string): Promise<SourceInfo | undefined> {
  const mem = sourceCache.get(id);
  if (mem) return mem;

  if (db) {
    try {
      const doc = await db.collection('sourceCache').doc(id).get();
      if (doc.exists) {
        const data = doc.data() as SourceInfo;
        sourceCache.set(id, data);
        return data;
      }
    } catch (e) {
      console.error('[⚠️] Error retrieving from Firestore sourceCache:', e);
    }
  }
  return undefined;
}

export function setSourceInfo(id: string, info: SourceInfo): void {
  sourceCache.set(id, info);
  if (db) {
    db.collection('sourceCache').doc(id).set(info).catch(e => {
      console.error('[⚠️] Error saving to Firestore sourceCache:', e);
    });
  }
}

export async function getGroupInfo(id: string): Promise<SourceInfo[] | undefined> {
  const mem = groupCache.get(id);
  if (mem) return mem;

  if (db) {
    try {
      const doc = await db.collection('groupCache').doc(id).get();
      if (doc.exists) {
        const data = (doc.data() as { sources: SourceInfo[] }).sources;
        groupCache.set(id, data);
        return data;
      }
    } catch (e) {
      console.error('[⚠️] Error retrieving from Firestore groupCache:', e);
    }
  }
  return undefined;
}

export function setGroupInfo(id: string, sources: SourceInfo[]): void {
  groupCache.set(id, sources);
  if (db) {
    db.collection('groupCache').doc(id).set({ sources }).catch(e => {
      console.error('[⚠️] Error saving to Firestore groupCache:', e);
    });
  }
}

export interface PaginationState {
  quranSources: any[];
  bookSources: any[];
  quranPageIndex: number;
  query?: string;
}

export const paginationCache = new Map<string, PaginationState>();
export const renamedTopicsCache = new Set<string>();
export const pendingSourcesCache = new Map<string, any>();
