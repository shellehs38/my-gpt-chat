import 'package:flutter/material.dart';

import 'app.dart';
import 'services/workspace_store.dart';
import 'services/manual_library.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ConstructionApp(
      store: WorkspaceStore(FileWorkspaceRepository()),
      manualLibrary: ManualLibrary(FileManualRepository()),
    ),
  );
}
