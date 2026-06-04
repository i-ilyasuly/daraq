# Security Specification for Firestore Rules

This document outlines the security requirements and invariants for the Daraq Firestore database to prevent privilege escalation, data poisoning, and unauthorized access.

## 1. Data Invariants
- **Message Integrity**: A message cannot be written without valid `role` ("user" or "bot"), `text` content, and a `timestamp` matching the server time.
- **Topic Ownership**: A topic under `users/{chatId}/topics` must only be modifiable by the owner of that `chatId`.
- **Cache Isolation**: The collections `sourceCache` and `groupCache` represent system caches. Standard clients are forbidden from writing to these collections. Writing is restricted entirely to system admins, while standard authenticated users can read them.
- **User Privacy**: No user can read or write to another user's chat logs or topics.

## 2. The "Dirty Dozen" Payloads
Here are 12 payloads representing malicious attempts to bypass restrictions:

1. **Payload 1: Spoofed Message Timestamp (Client Time)**
   - Path: `users/123/topics/general/messages/msg1`
   - Data: `{ role: "user", text: "Hello", timestamp: "2026-06-01T00:00:00Z" }` (Should fail because `timestamp` must equal `request.time`)
2. **Payload 2: Malformed Message Role**
   - Path: `users/123/topics/general/messages/msg2`
   - Data: `{ role: "admin", text: "Spoof admin role", timestamp: request.time }` (Should fail because `role` must be either "user" or "bot")
3. **Payload 3: Malformed Message Text Size (Too Long)**
   - Path: `users/123/topics/general/messages/msg3`
   - Data: `{ role: "user", text: "[100,000 characters ...]", timestamp: request.time }` (Should fail because `text` has a strict size limit of <= 10000 characters)
4. **Payload 4: Empty Message Fields**
   - Path: `users/123/topics/general/messages/msg4`
   - Data: `{ role: "user", timestamp: request.time }` (Should fail because `text` is required)
5. **Payload 5: Unauthorized SourceCache Overwrite**
   - Path: `sourceCache/book_page_1`
   - Data: `{ text: "Poisoned content", book: "Incorrect book", page: 1 }` (Should fail as client is not admin)
6. **Payload 6: Unauthorized Topic Rename by Non-Owner**
   - Path: `users/victim_123/topics/general`
   - Data: `{ title: "Hacked Topic", renamed: true, updatedAt: request.time }` (Should fail because request.auth.uid (attacker) is not equals victim_123)
7. **Payload 7: Unauthorized Message Read of Another User**
   - Read Request Path: `users/victim_123/topics/general/messages` (Should fail because auth.uid != victim_123)
8. **Payload 8: Injecting Negative or Junk Page Numbers in SourceCache**
   - Path: `sourceCache/book_page_invalid` (by attacker acting as admin)
   - Data: `{ text: "valid text", book: "testbook", page: -42 }` (Should fail because `page` must be >= 1)
9. **Payload 9: Missing Required Fields in GroupCache**
   - Path: `groupCache/test_group`
   - Data: `{ other: "missing sources" }` (Should fail because `sources` list is required)
10. **Payload 10: Setting Invalid State Keys in Topics**
    - Path: `users/123/topics/general`
    - Data: `{ title: "Valid Title", renamed: true, updatedAt: request.time, adminPrivilege: true }` (Should fail due to strict key checks using `.affectedKeys()`)
11. **Payload 11: Message Without Authentication**
    - Path: `users/123/topics/general/messages/msg_anon`
    - Request context: unauthenticated (Should fail due to `request.auth != null`)
12. **Payload 12: Injecting Malicious Document ID String**
    - Path: `users/123/topics/general-superlargejunkcharacterID-to-bloat-wallet-resources` (Should fail due to strict sub-path variable checks `isValidId()`)
