import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';

import '../theme.dart';

typedef NativePdfViewerBuilder = Widget Function(
  BuildContext context,
  Uint8List bytes,
  PdfViewerController controller,
  PdfViewerParams params,
);

/// PDFium renders the saved bytes in Flutter on iOS and Windows.
class PdfDocumentScreen extends StatefulWidget {
  const PdfDocumentScreen({
    super.key,
    required this.bytes,
    required this.title,
    this.initialPage = 1,
    this.viewerBuilder,
  });

  final Uint8List bytes;
  final String title;
  final int initialPage;
  final NativePdfViewerBuilder? viewerBuilder;

  @override
  State<PdfDocumentScreen> createState() => _PdfDocumentScreenState();
}

class _PdfDocumentScreenState extends State<PdfDocumentScreen> {
  final _controller = PdfViewerController();
  late String _sourceName;
  int _page = 1, _pageCount = 0;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _sourceName = 'manual-${sha256.convert(widget.bytes)}';
  }

  @override
  void didUpdateWidget(covariant PdfDocumentScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sourceName = 'manual-${sha256.convert(widget.bytes)}';
    if (_sourceName != sourceName) {
      _sourceName = sourceName;
      _page = 1;
      _pageCount = 0;
      _failed = false;
    }
  }

  void _documentChanged(PdfDocument? document) {
    if (!mounted) return;
    setState(() {
      _pageCount = document?.pages.length ?? 0;
      _page = _pageCount == 0 ? 1 : widget.initialPage.clamp(1, _pageCount);
    });
  }

  void _markFailed() {
    if (_failed) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_failed) setState(() => _failed = true);
    });
  }

  Future<void> _goTo(int page) async {
    if (!_controller.isReady || page < 1 || page > _pageCount) return;
    await _controller.goToPage(pageNumber: page);
  }

  @override
  Widget build(BuildContext context) {
    final params = PdfViewerParams(
      backgroundColor: canvas,
      // No URL launcher or browser is used for PDF links.
      linkHandlerParams: null,
      onDocumentChanged: _documentChanged,
      onViewerReady: (document, _) {
        if (!mounted) return;
        setState(() {
          _pageCount = document.pages.length;
          _failed = false;
        });
      },
      onPageChanged: (page) {
        if (mounted && page != null) setState(() => _page = page);
      },
      loadingBannerBuilder: (_, _, _) =>
          const Center(child: CircularProgressIndicator()),
      errorBannerBuilder: (context, error, stackTrace, documentRef) {
        _markFailed();
        return const Center(
          child: Padding(
            padding: EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.picture_as_pdf_outlined, size: 42, color: muted),
                SizedBox(height: 14),
                Text(
                  'Не удалось открыть PDF',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  textAlign: TextAlign.center,
                ),
                SizedBox(height: 10),
                Text(
                  'Проверьте файл. Повреждённый или защищённый паролем документ может не открыться. Можно добавить другой PDF в этом профиле.',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        );
      },
    );
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset(
              'assets/brand/logo-sl-approved-light.png',
              width: 48,
              height: 30,
              fit: BoxFit.contain,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                widget.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Material(
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                child: Row(
                  children: [
                    IconButton(
                      key: const ValueKey('pdf-previous-page'),
                      tooltip: 'Предыдущая страница',
                      onPressed: _pageCount > 0 && _page > 1 && !_failed
                          ? () => _goTo(_page - 1)
                          : null,
                      icon: const Icon(Icons.chevron_left),
                    ),
                    Expanded(
                      child: Text(
                        _failed
                            ? 'PDF не открыт'
                            : _pageCount == 0
                            ? 'Открываем PDF…'
                            : 'Страница $_page из $_pageCount',
                        key: const ValueKey('pdf-page-counter'),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('pdf-next-page'),
                      tooltip: 'Следующая страница',
                      onPressed:
                          _pageCount > 0 && _page < _pageCount && !_failed
                          ? () => _goTo(_page + 1)
                          : null,
                      icon: const Icon(Icons.chevron_right),
                    ),
                    IconButton(
                      tooltip: 'Уменьшить',
                      onPressed: _pageCount > 0 && !_failed
                          ? () {
                              if (_controller.isReady) _controller.zoomDown();
                            }
                          : null,
                      icon: const Icon(Icons.zoom_out),
                    ),
                    IconButton(
                      tooltip: 'Увеличить',
                      onPressed: _pageCount > 0 && !_failed
                          ? () {
                              if (_controller.isReady) _controller.zoomUp();
                            }
                          : null,
                      icon: const Icon(Icons.zoom_in),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child:
                  widget.viewerBuilder?.call(
                    context,
                    widget.bytes,
                    _controller,
                    params,
                  ) ??
                  PdfViewer.data(
                    widget.bytes,
                    sourceName: _sourceName,
                    initialPageNumber: widget.initialPage,
                    controller: _controller,
                    params: params,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
