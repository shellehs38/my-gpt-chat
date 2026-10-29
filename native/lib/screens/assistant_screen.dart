import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/workspace.dart';
import '../services/assistant_controller.dart';
import '../services/workspace_store.dart';
import '../theme.dart';
import 'workspace_panels.dart';

const _modeLabels = {
  'general': 'Общие вопросы',
  'estimate': 'Сметы и расчёты',
  'engineering': 'Технологии и конструкции',
  'facade': 'Фасады',
  'business': 'Бизнес и продажи',
  'documents': 'Документы',
};

class AssistantScreen extends StatefulWidget {
  const AssistantScreen({
    super.key,
    required this.store,
    required this.controller,
  });

  final WorkspaceStore store;
  final AssistantController controller;

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _password = TextEditingController();
  bool _showPassword = false;

  @override
  void dispose() {
    _password.clear();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_password.text.isEmpty || widget.controller.signingIn) return;
    FocusScope.of(context).unfocus();
    try {
      await widget.controller.signIn(_password.text);
    } finally {
      if (mounted) _password.clear();
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.store, widget.controller]),
    builder: (context, _) {
      final store = widget.store;
      final controller = widget.controller;
      final project = store.activeProject;
      final thread = store.activeAssistantThread;
      final mode = _modeLabels.containsKey(store.data.assistantMode)
          ? store.data.assistantMode
          : 'general';
      return PageContent(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeading(
              'СТРОИТЕЛЬНЫЙ ПОМОЩНИК',
              'Диалог о вашем\nобъекте.',
              subtitle: 'Отдельная история для каждого объекта и направления.',
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusPill(
                  controller.authenticated
                      ? 'Вы вошли в помощник'
                      : 'Для ответа ИИ нужен вход и интернет',
                  example: !controller.authenticated,
                ),
                if (controller.authenticated)
                  TextButton.icon(
                    key: const ValueKey('assistant-sign-out'),
                    onPressed: controller.signingIn ? null : controller.signOut,
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Выйти'),
                  ),
              ],
            ),
            if (!controller.authenticated) ...[
              const SizedBox(height: 18),
              _loginCard(),
            ],
            if (controller.error != null) ...[
              const SizedBox(height: 18),
              _Notice(
                text: controller.error!,
                error: true,
                onDismiss: controller.clearError,
              ),
            ],
            if (controller.info != null) ...[
              const SizedBox(height: 18),
              _Notice(text: controller.info!),
            ],
            const SizedBox(height: 20),
            WorkCard(
              padding: EdgeInsets.all(
                MediaQuery.sizeOf(context).width < 600 ? 18 : 24,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    project?.name ?? 'Общие вопросы без объекта',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    project == null
                        ? 'Выберите объект в разделе «Объекты», если вопрос относится к конкретной стройке.'
                        : 'Название, адрес и последний сохранённый расчёт будут отправлены помощнику вместе с вопросом.',
                    style: const TextStyle(color: muted),
                  ),
                  const SizedBox(height: 20),
                  DropdownButtonFormField<String>(
                    key: ValueKey('assistant-mode-$mode'),
                    initialValue: mode,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Направление'),
                    items: [
                      for (final entry in _modeLabels.entries)
                        DropdownMenuItem(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                    ],
                    onChanged: (value) {
                      if (value != null) store.updateAssistant(mode: value);
                    },
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const ValueKey('assistant-new-conversation'),
                      onPressed: controller.sending
                          ? null
                          : controller.newConversation,
                      icon: const Icon(Icons.add_comment_outlined, size: 18),
                      label: const Text('Очистить этот диалог'),
                    ),
                  ),
                  if (thread.messages.isNotEmpty)
                    const Text(
                      'Сообщения этого диалога будут удалены с устройства.',
                      style: TextStyle(color: muted, fontSize: 11),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (thread.messages.isEmpty)
              const WorkCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.auto_awesome_outlined, color: muted),
                    SizedBox(height: 12),
                    Text(
                      'С чего начнём?',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Опишите задачу и известные исходные данные. Например: «Какие замеры нужны для расчёта сайдинга?»',
                      style: TextStyle(color: muted),
                    ),
                  ],
                ),
              )
            else
              for (final message in thread.messages) ...[
                _MessageBubble(
                  key: ValueKey('assistant-message-${message.id}'),
                  message: message,
                ),
                const SizedBox(height: 14),
              ],
            if (controller.sending) ...[
              const SizedBox(height: 6),
              const _Notice(
                text: 'Помощник готовит ответ. Он сохранится в исходном диалоге, даже если вы переключите объект или направление.',
                busy: true,
              ),
            ],
            const SizedBox(height: 20),
            WorkCard(
              padding: EdgeInsets.all(
                MediaQuery.sizeOf(context).width < 600 ? 18 : 24,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _DraftField(
                    key: ValueKey('assistant-draft-${thread.id}'),
                    text: thread.draft,
                    onChanged: store.updateAssistantDraft,
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    key: const ValueKey('assistant-send'),
                    onPressed:
                        controller.authenticated &&
                            !controller.sending &&
                            thread.draft.trim().isNotEmpty
                        ? controller.send
                        : null,
                    icon: const Icon(Icons.arrow_upward, size: 18),
                    label: Text(
                      controller.sending
                          ? 'Ожидаем ответ…'
                          : 'Отправить вопрос',
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Ответы создаёт ИИ. Проверяйте размеры, цены и применимость технических решений по проекту и инструкции производителя.',
                    style: TextStyle(color: muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      );
    },
  );

  Widget _loginCard() {
    final controller = widget.controller;
    return WorkCard(
      padding: EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 18 : 24),
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Вход владельца',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Используйте пароль вашего строительного помощника. Вход действует во время работы приложения. После закрытия потребуется пароль.',
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 18),
            TextField(
              key: const ValueKey('assistant-password'),
              controller: _password,
              enabled: !controller.signingIn,
              obscureText: !_showPassword,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.password],
              keyboardType: TextInputType.visiblePassword,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _signIn(),
              decoration: InputDecoration(
                labelText: 'Пароль помощника',
                suffixIcon: IconButton(
                  tooltip: _showPassword ? 'Скрыть пароль' : 'Показать пароль',
                  onPressed: controller.signingIn
                      ? null
                      : () => setState(() => _showPassword = !_showPassword),
                  icon: Icon(
                    _showPassword
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              key: const ValueKey('assistant-sign-in'),
              onPressed: controller.signingIn ? null : _signIn,
              icon: controller.signingIn
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.lock_open_outlined, size: 18),
              label: Text(controller.signingIn ? 'Входим…' : 'Войти'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DraftField extends StatefulWidget {
  const _DraftField({super.key, required this.text, required this.onChanged});
  final String text;
  final ValueChanged<String> onChanged;

  @override
  State<_DraftField> createState() => _DraftFieldState();
}

class _DraftFieldState extends State<_DraftField> {
  late final TextEditingController _text;
  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.text);
  }

  @override
  void didUpdateWidget(_DraftField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_text.text != widget.text) {
      _text.value = TextEditingValue(
        text: widget.text,
        selection: TextSelection.collapsed(offset: widget.text.length),
      );
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
    key: const ValueKey('assistant-question'),
    controller: _text,
    minLines: 3,
    maxLines: 10,
    maxLength: 4000,
    maxLengthEnforcement: MaxLengthEnforcement.enforced,
    textCapitalization: TextCapitalization.sentences,
    onChanged: widget.onChanged,
    decoration: const InputDecoration(
      labelText: 'Ваш вопрос',
      alignLabelWithHint: true,
      hintText: 'Опишите задачу, размеры и известные условия',
    ),
  );
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({super.key, required this.message});
  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final own = message.role == 'user';
    return Container(
      padding: EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 18 : 24),
      decoration: BoxDecoration(
        color: own ? const Color(0xffeaf1d9) : Colors.white,
        border: Border.all(color: const Color(0xffe1e6dc)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                own ? Icons.person_outline : Icons.auto_awesome_outlined,
                color: muted,
                size: 17,
              ),
              const SizedBox(width: 8),
              Text(
                own ? 'Вы' : 'Помощник · ИИ',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Скопировать сообщение',
                visualDensity: VisualDensity.compact,
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: message.content));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Сообщение скопировано')),
                    );
                  }
                },
                icon: const Icon(Icons.copy_outlined, size: 17),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SelectableText(
            message.content,
            style: const TextStyle(color: ink, fontSize: 14, height: 1.7),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.text,
    this.error = false,
    this.busy = false,
    this.onDismiss,
  });
  final String text;
  final bool error, busy;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: error ? const Color(0xfffff0e8) : const Color(0xffeef3e7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (busy)
            const Padding(
              padding: EdgeInsets.only(top: 3),
              child: SizedBox.square(
                dimension: 17,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            Icon(
              error ? Icons.error_outline : Icons.info_outline,
              size: 19,
              color: error ? const Color(0xff944c29) : muted,
            ),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
          if (onDismiss != null)
            IconButton(
              tooltip: 'Закрыть сообщение',
              visualDensity: VisualDensity.compact,
              onPressed: onDismiss,
              icon: const Icon(Icons.close, size: 18),
            ),
        ],
      ),
    ),
  );
}
