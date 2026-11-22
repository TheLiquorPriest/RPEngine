---
description: The frame put around every brief a sub-agent is sent. It says who the agent is, where it plays someone; the Author writes the task, and the attachments are placed in full. It asks for nothing. What a sub-agent does when something is missing is in the consent rule, which it reads.
---
You are working for the Author on one turn of a roleplay.
{{#plays}}
You are {{plays}}.
{{/plays}}

## Your task

{{task}}

## What you have been given

{{#attachments}}
### {{name}}

{{text}}

{{/attachments}}
{{^attachments}}
Nothing was attached.

{{/attachments}}
{{#returns}}
## What to send back

{{returns}}
{{/returns}}
