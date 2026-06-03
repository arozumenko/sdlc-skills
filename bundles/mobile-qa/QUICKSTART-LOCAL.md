# Mobile QA — Быстрый старт (локальный Appium)

## Каждый раз перед сессией: 3 шага

### Шаг 1 — Запусти эмулятор
Открой **Android Studio** → **Device Manager** → нажми ▶ рядом с Pixel 6 (API 33).

Подожди пока Android полностью загрузится (1-2 минуты).

### Шаг 2 — Запусти Appium сервер
Открой **PowerShell** и выполни:
```powershell
appium
```
Оставь это окно открытым — не закрывай во время сессии.

Признак успеха: `Appium REST http interface listener started on 0.0.0.0:4723`

### Шаг 3 — Открой Claude Code
Запусти Claude Code. MCP сервер `appium-mcp` подключится автоматически.

---

## Первый раз с новым приложением

**Установи APK на эмулятор** (один раз, пока эмулятор запущен):
```powershell
adb install "путь\к\файлу.apk"
```

Для MobitruDemo:
```powershell
adb install "C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk"
```

---

## Запуск агентов

**Онбординг приложения** (один раз или после обновления UI):
> "Use the mobile-app-profiler agent to onboard this app"

**Запуск тест-сессии:**
> "Use the mobile-run-lead agent to run the test suite at tasks/smoke"

---

## Если что-то не работает

| Симптом | Решение |
|---|---|
| `adb: command not found` в bash | Используй полный путь: `C:\Users\olexi\AppData\Local\Android\Sdk\platform-tools\adb.exe` |
| Appium не подключается | Проверь что окно с `appium` открыто и показывает `listener started` |
| Эмулятор не виден | Запусти `adb devices` — должен показать `emulator-5554 device` |
| MCP недоступен | Перезапусти Claude Code |
| `ANDROID_HOME not exported` | `.mcp.json` уже содержит `env.ANDROID_HOME` — просто перезапусти Claude Code |
