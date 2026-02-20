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

## How It Stays Private On A Public Blockchain

Blockchains are designed to be transparent. Everything is recorded forever. So how does POMP keep things private?

### What Goes On-Chain vs Off-Chain

```
┌─────────────────────────────────────────────────────────────┐
│                    ON-CHAIN (Everyone Sees)                 │
├─────────────────────────────────────────────────────────────┤
│  • Proof that sender is registered (not WHO, just THAT)     │
│  • A random-looking address (not the recipient's real one)  │
│  • A tiny "view tag" (one byte for scanning)                │
│  • Encrypted metadata blob                                  │
│  • A "nullifier" (prevents sending twice)                   │
│                                                             │
│  ❌ No message content                                      │
│  ❌ No sender identity                                      │
│  ❌ No recipient identity                                   │
│  ❌ No link to previous messages                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 OFF-CHAIN (IPFS - Decentralized Storage)    │
├─────────────────────────────────────────────────────────────┤
│  • The actual encrypted message                             │
│  • File attachments                                         │
│                                                             │
│  Only accessible if you have the decryption key             │
└─────────────────────────────────────────────────────────────┘
```

### How Verification Works (Without Revealing Identity)

The magic is in **Zero-Knowledge Proofs**.

Normal verification: "Hi, I'm Alice, here's my ID, let me send this."
- Problem: Everyone knows Alice sent something

POMP verification: "Hi, I can prove I'm registered, but I won't tell you who I am."
- The proof mathematically guarantees: "This person is in the allowed list"
- But reveals zero information about WHICH person

**Analogy:**

Imagine a club with a membership list. The bouncer checks your ID at the door.

- **Normal:** Bouncer announces "Alice is entering!" - everyone knows
- **POMP:** You show a magical ticket that proves "I'm on the list" without showing your name - bouncer lets you in, but can't tell anyone who you are

### How Recipients Stay Hidden (Stealth Addresses)

Every message goes to a unique, one-time address.

**The Setup:**
- You publish TWO public keys: a "viewing key" and a "spending key"
- These are NOT your main wallet address

**When Someone Sends You A Message:**
1. They generate a random temporary key
2. Mathematically combine it with your viewing key → creates a shared secret
3. Use that secret + your spending key → creates a unique address just for this message
4. Post the message to that address

**Why This Works:**
- Only YOU can recognize addresses created this way (you have the private keys)
- Each message has a completely different address
- No pattern connecting them to you
- To everyone else: random addresses with no owner

**Scanning Efficiently:**
- Each message has a "view tag" (like a flag)
- You compute: "My view tag would be blue"
- Only check messages with blue flags
- Skip 255 out of 256 messages (super fast)

### The Full Picture

```
SENDER                                    RECEIVER
   │                                          │
   │  1. Get receiver's public keys           │
   │     (viewing key, spending key)          │
   │                                          │
   │  2. Create one-time address              │
   │     (using random + their keys)          │
   │                                          │
   │  3. Encrypt message                      │
   │     (only they can decrypt)              │
   │                                          │
   │  4. Generate ZK proof                    │
   │     ("I'm registered" - no identity)     │
   │                                          │
   │  5. Post to blockchain:                  │
   │     - stealth address (random looking)   │
   │     - encrypted data                     │
   │     - proof                              │
   │     - nullifier (unique ID)              │
   │                                          │
   └──────────────► BLOCKCHAIN ◄──────────────┘
                           │
                           │  Everyone sees:
                           │  - "Someone" sent something
                           │  - To "some address"
                           │  - With valid proof
                           │  - No idea who/what
                           │
                           ▼
                    RECEIVER SCANS:
                           │
                    "Does this view tag match?"
                           │
                    YES → "Can I derive this address?"
                           │
                    YES → "This is for me!"
                           │
                    Decrypt and read
```

### What Prevents Cheating?

| Attack | Prevention |
|--------|------------|
| Send without being registered | ZK proof required - math guarantees membership |
| Send as someone else | ZK proof requires knowing private identity keys |
| Send same message twice | Nullifier tracked on-chain - duplicates rejected |
| Read others' messages | Need recipient's private viewing key |
| Link messages to same person | Each message uses different keys and addresses |
| Fake a message from you | Would need your private signing key |

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
