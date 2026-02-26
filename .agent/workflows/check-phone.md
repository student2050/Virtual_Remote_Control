---
description: Check for new messages from the user's phone via PHP relay and respond
---

# Check Phone Messages Workflow
// turbo-all

This workflow is triggered either manually or automatically by the phone-bridge daemon.

## 1. Check for new messages from the phone

```bash
curl -s --max-time 15 "https://www.virtualtecserver.com/antigravity/api.php?action=inbox&role=user" | python3 -m json.tool 2>/dev/null | tail -30
```

## 2. Read the messages and compose a response

After reading the messages, compose an appropriate response based on what the user asked. Treat phone messages exactly like regular user messages - they ARE the user talking to you.

## 3. Send the response back to the phone

IMPORTANT: After composing your response, you MUST send it to the phone via curl. Replace YOUR_RESPONSE_HERE with your actual response:

```bash
curl -s --max-time 15 -X POST "https://www.virtualtecserver.com/antigravity/api.php?action=send" -H "Content-Type: application/json" -d '{"action":"send","content":"YOUR_RESPONSE_HERE","role":"agent","token":"ag_antigravity_permanent_key_2025"}'
```

## Notes
- The API is at `https://www.virtualtecserver.com/antigravity/api.php`
- To send as agent: role=agent, token=ag_antigravity_permanent_key_2025
- To read user messages: `?action=inbox&role=user`
- To read only new messages: `?action=inbox&since=TIMESTAMP&role=user`
- ALWAYS send your response back to the phone - the user is waiting for it on mobile!
