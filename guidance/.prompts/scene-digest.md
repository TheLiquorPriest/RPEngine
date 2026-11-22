---
description: The layout of the scene digest an agent is given by name (story:scene-digest), beside the part of the scene's messages it is handed. The scene before this one, by its title and the summary the story record holds of it; then the beats recorded in this scene for the messages that came before the ones handed over. It lays out what the record holds, and nothing is summarized for it. When the record holds neither, the none part says so. It asks for nothing.
---
{{#none}}
No scene stands before this one in the story record, and nothing of this scene lies before the messages you were handed.
{{/none}}
{{#before}}
### The scene before [{{before.id}}]{{#before.title}}: {{before.title}}{{/before.title}}

{{#before.span}}
- Messages {{before.span.from}} to {{before.span.to}}
{{/before.span}}
{{#before.summary}}
- {{before.summary}}
{{/before.summary}}
{{^before.summary}}
- No summary of it is recorded. story_query with its id reads what the record holds of it, and chat_read its messages.
{{/before.summary}}

{{/before}}
{{#earlier}}
### Earlier in this scene, messages {{earlier.from}} to {{earlier.to}}

These came before the messages you were handed. Each is a beat as recorded; chat_read reads the messages themselves.

{{#earlier.items}}
- [{{id}}] (message {{message}}) {{text}}
{{/earlier.items}}
{{/earlier}}
