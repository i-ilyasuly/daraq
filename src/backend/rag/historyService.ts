import { db } from '../db/firestore';

/**
 * Хабарламаларды Firestore-ға сақтау
 */
export async function rewindHistory(chatId: string, threadId: string | number | undefined, targetMsgId: number, newText: string): Promise<{deletedMsgIds: number[], updatedUserQuery: boolean}> {
  const result = { deletedMsgIds: [] as number[], updatedUserQuery: false };
  if (!db) return result;
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    const msgRef = db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages');
    
    // First, try to find the message by msgId
    let snapshot = await msgRef.where('msgId', '==', targetMsgId).get();
    
    if (snapshot.empty) {
      console.log(`[⚠️] Cannot rewind history, message ID ${targetMsgId} not found in Firestore. Older message format?`);
      return result;
    }
    
    const targetDoc = snapshot.docs[0];
    const targetTimestamp = targetDoc.data().timestamp;

    // We want to delete everything strictly AFTER this user message
    const toDelete = await msgRef.where('timestamp', '>', targetTimestamp).get();
    
    const batch = db.batch();
    toDelete.forEach((doc) => {
      batch.delete(doc.ref);
      const mId = doc.data().msgId;
      if (mId && typeof mId === 'number') {
         result.deletedMsgIds.push(mId);
      }
    });

    // OVERWRITE the user message query per user's explicit request
    batch.update(targetDoc.ref, { text: newText });

    await batch.commit();
    result.updatedUserQuery = true;
    console.log(`[✅] Rewound history: Updated target message ${targetMsgId} and deleted ${toDelete.size} subsequent messages`);
  } catch(e) {
    console.error("[❌] Error rewinding history:", e);
  }
  return result;
}

export async function saveToChatHistory(chatId: string, role: 'user' | 'bot', text: string, threadId?: string | number, msgId?: number, replyToMsgId?: number) {
  if (!db) return;
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    const payload: any = { role, text, timestamp: new Date() };
    if (msgId) payload.msgId = msgId;
    if (replyToMsgId) payload.replyToMsgId = replyToMsgId;
    await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages').add(payload);
  } catch (error) {
    console.error("[❌] Хабарламаны сақтау кезінде қате орын алды (Firestore Error):", error);
  }
}


