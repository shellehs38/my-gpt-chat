import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:file_selector/file_selector.dart' as files;
import 'package:share_plus/share_plus.dart';

Future<bool> saveNativeFile(
  BuildContext context, {
  required Uint8List bytes,
  required String name,
  required String mimeType,
}) async {
  if (Platform.isIOS) {
    final box = context.findRenderObject() as RenderBox?;
    final origin = box == null
        ? const Rect.fromLTWH(0, 0, 100, 100)
        : box.localToGlobal(Offset.zero) & box.size;
    final result = await SharePlus.instance.share(
      ShareParams(
        files: [files.XFile.fromData(bytes, mimeType: mimeType)],
        fileNameOverrides: [name],
        sharePositionOrigin: origin,
      ),
    );
    return result.status == ShareResultStatus.success;
  }
  final location = await files.getSaveLocation(
    suggestedName: name,
    acceptedTypeGroups: [
      files.XTypeGroup(
        label: mimeType == 'application/pdf' ? 'PDF' : 'Резервная копия',
        extensions: [mimeType == 'application/pdf' ? 'pdf' : 'json'],
      ),
    ],
  );
  if (location == null) return false;
  await files.XFile.fromData(
    bytes,
    mimeType: mimeType,
    name: name,
  ).saveTo(location.path);
  return true;
}

Future<String?> selectNativeBackup() async {
  final file = await files.openFile(
    acceptedTypeGroups: [
      const files.XTypeGroup(
        label: 'Резервная копия СВОИ ЛЮДИ',
        extensions: ['json'],
        uniformTypeIdentifiers: ['public.json'],
      ),
    ],
  );
  if (file == null) return null;
  if (await file.length() > 10 * 1024 * 1024) {
    throw const FormatException('Размер копии превышает 10 МБ');
  }
  return file.readAsString();
}
