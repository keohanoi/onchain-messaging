# POMP - Private Onchain Messaging Protocol

Send messages on a public blockchain without anyone knowing who you're talking to.

---

## The Problem

Blockchains are public. Every transaction is visible forever.

When you send someone a message on-chain, everyone can see:
- **Who sent it** (your wallet address)
- **Who received it** (their wallet address)
- **When** you sent it
- **Your relationship** with them

This is like having all your emails published in the newspaper.

**POMP fixes this.**

---

## What POMP Does

| Normally Visible | POMP Makes It |
|------------------|---------------|
| Your identity | Hidden - you prove you're allowed to send without revealing who you are |
| Recipient's identity | Hidden - messages go to random addresses only they can recognize |
| Your conversation | Encrypted - no one can read it but you two |
| Link between messages | Broken - each message looks unrelated |

---

## How It Works (Simple)

### Sending a Message

```
You                                     Blockchain
 │                                          │
 │  1. Write "Hello!"                       │
 │                                          │
 │  2. Encrypt it (only recipient can read) │
 │                                          │
 │  3. Prove you're registered              │
 │     (without saying WHO you are)         │
 │                                          │
 │  4. Send to a random address             │
 │     (only recipient knows it's theirs)   │
 │                                          │
 └──────────────────────────────────────────┘
```

To an observer, it looks like:
- "Someone" sent an encrypted blob
- To a random address they've never seen
- With a proof that they're allowed to send
- No way to tell who or what

### Receiving a Message

The recipient doesn't check every message. That would be slow.

Instead:
1. Messages have a "view tag" (like a colored flag)
2. Recipient only checks messages with their color
3. Only 1 in 256 messages match - super fast
4. If it matches, they can open it

---

## The Privacy Layers

Think of it like sending a letter:

| Layer | Analogy | What It Hides |
|-------|---------|---------------|
| **Envelope** | Put letter in sealed envelope | Content is encrypted |
| **Drop box** | Drop in public mailbox, not your house | Sender identity hidden |
| **Fake address** | Send to a temporary forwarding address | Recipient identity hidden |
| **Code name** | Sign with a code name, not real name | No link to your other messages |

---

## Why This Matters

**Without privacy:**
- Your boss sees you're talking to a competitor
- Your ex sees you're dating someone new
- Scammers map your social graph for targeted attacks
- Governments track who knows whom

**With POMP:**
- Your conversations are truly private
- Your relationships stay hidden
- You control what others can see

---

## What's Still Visible

POMP hides content and identities, but not everything:

| Hidden | Still Visible |
|--------|---------------|
| Message content | That *someone* sent a message |
| Who sent it | What time it was sent |
| Who received it | How big the message is |

This is like seeing envelopes in a mailbox - you know mail exists, but not who it's between or what's inside.

---

## Security Guarantees

**Forward Secrecy**
If someone steals your keys tomorrow, they can't read yesterday's messages. Each message uses a new key.

**Break-in Recovery**
Even if your device is compromised, the next message establishes new secure keys.

**Deniability**
Messages could have been forged by the recipient. This isn't a bug - it's a feature. It means you can't be held to your messages cryptographically.

**No Replay**
Each message can only be sent once. The system rejects duplicates.
