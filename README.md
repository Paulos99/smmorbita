# smmorbita.ru — static shell

Static front for the SMM school archive. No course materials or catalog here: after login the page calls the school API (Yandex Cloud), which checks the token and returns the student's own lessons with short-lived links.
The teacher cabinet is `admin.html`. The API allows it only for the teacher role. The «Пользователи» tab searches and filters accounts, and adds, edits, disables, and deletes them. Lessons can also include an HTML page and a video (or a YouTube, VK, or Rutube link). Students watch them on the lesson page.
