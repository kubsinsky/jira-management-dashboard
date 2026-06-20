import os

path = 'src/jiraNotifications.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix expand payload
old_expand = "expand: ['changelog']"
new_expand = "expand: 'changelog'"
content = content.replace(old_expand, new_expand)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Patch 3 applied successfully')
