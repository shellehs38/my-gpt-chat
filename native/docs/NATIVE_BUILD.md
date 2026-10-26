![СВОИ ЛЮДИ](../assets/brand/logo-sl-approved-light.png)

# Нативные сборки: iPhone и Windows

Это техническая инструкция к исходному проекту Flutter 3.47.8. Подготовленные команды и workflow не являются подтверждением выполненной сборки или установки. Нативный интерфейс запускается в приложении, без WebView.

## Общая проверка

Flutter SDK должен иметь версию 3.47.8. Из корня проекта:

```sh
flutter --version
flutter pub get --enforce-lockfile
flutter analyze --fatal-infos
flutter test
```

`pubspec.lock` хранится вместе с приложением. Если намеренно меняются зависимости, lock-файл обновляется и проверяется отдельно. Изменение платформенных настроек требует повторной сборки соответствующей платформы.

Калькулятор и загруженные в комплект инструкции могут работать без сети. Локальный JSON не является синхронизацией между устройствами. Подготовка текста запроса не вызывает модель ИИ.

## Windows

Потребуется Windows с Flutter SDK и Visual Studio. В Visual Studio Installer установите workload **Desktop development with C++**; редактор Visual Studio Code его не заменяет.

```powershell
flutter config --enable-windows-desktop
flutter doctor -v
flutter devices
flutter pub get --enforce-lockfile
flutter run -d windows
```

После проверки приложения:

```powershell
flutter build windows --release
```

Для стандартной x64-сборки результат находится в `build/windows/x64/runner/Release/`. Передавать нужно всю папку: исполняемый файл, библиотеки и `data`, а не только `.exe`. Это portable-сборка приложения; установщик и подпись Windows в текущий workflow не входят. Пакет проверяется на отдельном Windows-компьютере, включая доступ к файлам и печать.

Официальная настройка: [Flutter — Windows development](https://docs.flutter.dev/platform-integration/windows/setup).

## iPhone: компиляция

Для iOS требуется macOS с Xcode и средствами сборки, совместимыми с выбранной версией Flutter. Для нативных зависимостей также могут потребоваться CocoaPods. Платформенный проект находится в `ios/`.

```sh
flutter doctor -v
flutter pub get --enforce-lockfile
flutter build ios --release --no-codesign
```

Эта команда проверяет компиляцию и создаёт неподписанный `build/ios/iphoneos/Runner.app`. Это **unsigned compile-only artifact**, не подписанная IPA и не готовый пакет для обычной установки на телефон.

Для запуска на подключённом личном устройстве в Xcode нужны выбранная команда разработчика, принадлежащий владельцу Bundle ID, доверие устройству и Developer Mode. Бесплатный Apple Personal Team допускает личное тестирование, но provisioning-профили истекают через 7 дней, после чего приложение требуется собрать и установить заново. Такой вариант не равен постоянному распространению приложения.

Официальные сведения: [Flutter — iOS setup](https://docs.flutter.dev/platform-integration/ios/setup), [Apple — Personal Team и программы разработчика](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Подписанная IPA и TestFlight

Для выпуска через TestFlight/App Store потребуются Apple Developer Program и настройка приложения в App Store Connect. После подготовки команды, идентификатора и подписи используется:

```sh
flutter build ipa --release
```

На этом этапе нужно проверить итоговый архив, подпись, разрешения и сборку на настоящем iPhone. Загрузка в TestFlight выполняется отдельно. Текущий workflow не создаёт сертификаты, provisioning-профили и подписанные IPA, не принимает соглашения и ничего не публикует.

Учётные данные Apple, сертификаты и ключи не добавляются в Git и не передаются в чат. Когда подписанная сборка будет подготовлена, они настраиваются в защищённом хранилище сборочной среды владельца.

Официальная инструкция: [Flutter — build and release an iOS app](https://docs.flutter.dev/deployment/ios).

## Ручная сборка в GitHub Actions

Файл: `.github/workflows/native-builds.yml`. Он должен находиться в корне репозитория именно этого Flutter-приложения.

1. Откройте **Actions → Native builds → Run workflow**.
2. Выберите ветку и нужные платформы: Windows и/или unsigned iOS.
3. Сначала должны успешно завершиться анализ и тесты на Ubuntu.
4. Для Windows скачайте артефакт `windows-x64-portable-…`, распакуйте целиком и проверьте запуск.
5. Артефакт `ios-unsigned-COMPILE-ONLY-…` содержит скомпилированную неподписанную `.app`; для установки потребуется отдельная подпись.

Workflow работает только по `workflow_dispatch`, не запускается автоматически при push и не выполняет публикацию. Использование GitHub-hosted runners зависит от настроек и доступных минут аккаунта владельца. В рамках подготовки файлов удалённые workflow не запускались.

GitHub Actions зафиксированы проверенными SHA: checkout v6, upload-artifact v6 и flutter-action v2. Flutter SDK зафиксирован на 3.47.8. Результаты native-сборок необходимо проверять по фактическим журналам конкретного запуска.

## Что ещё нужно для живого помощника

Текущие `/api/auth` и `/api/chat` веб-проекта используют подписанную cookie-сессию и проверку Origin. Нативному приложению требуется отдельная интеграция авторизации и серверного чата. Браузерную проверку Origin сохраняют; ключ OpenAI остаётся на сервере. В этой версии подготовленные запросы локальные, живой ИИ и облачная синхронизация не подключены.

## Границы проверки

Анализ Dart и Flutter widget tests могут выполняться на Linux. Они не проверяют Xcode, подпись Apple, Windows SDK, установку на устройство, системный диалог файлов или печать на целевых ОС. Эти проверки завершаются на соответствующих платформах до выдачи установочных пакетов пользователю.

