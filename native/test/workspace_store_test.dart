import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/domain/siding_calculator.dart';
import 'package:svoi_lyudi_native/models/workspace.dart';
import 'package:svoi_lyudi_native/services/workspace_store.dart';

void main() {
  test('lifecycle save before loading never overwrites stored data', () async {
    final original = _workspaceWithCalculation();
    final repository = MemoryWorkspaceRepository(original);
    final store = WorkspaceStore(repository);
    expect(await store.saveNow(), isFalse);
    expect(repository.data!.toJson(), original.toJson());
    await store.initialize();
    expect(store.activeProject!.id, 'one');
    store.dispose();
    expect(await store.saveNow(), isFalse);
  });

  test('an explicit valid import recovers blocked writes and preserves damaged source', () async {
    final directory = await Directory.systemTemp.createTemp('svoi-recovery-');
    addTearDown(() => directory.delete(recursive: true));
    final repository = FileWorkspaceRepository(directory: directory);
    await repository.write(WorkspaceData.demo());
    await repository.write(_workspaceWithCalculation());
    final file = File(
      '${directory.path}${Platform.pathSeparator}svoi-lyudi-workspace.json',
    );
    await file.writeAsString('{damaged');
    final store = WorkspaceStore(repository);
    addTearDown(store.dispose);
    await store.initialize();
    expect(await store.saveNow(), isFalse);
    expect(
      await store.importCopies(
        jsonEncode(_workspaceWithCalculation().toJson()),
      ),
      1,
    );
    expect(await store.saveNow(), isTrue);
    expect(
      (await repository.read())!.projects.any(
        (p) => p.name.contains('Контрольный объект'),
      ),
      isTrue,
    );
    final damaged = await directory
        .list()
        .where((f) => f.path.contains('.damaged-'))
        .toList();
    expect(damaged, hasLength(1));
    expect(await File(damaged.single.path).readAsString(), '{damaged');
    expect(await File('${file.path}.backup').exists(), isTrue);
  });
  group('Native workspace files', () {
    late Directory directory;

    setUp(() async {
      directory = await Directory.systemTemp.createTemp('svoi-native-store-');
    });
    tearDown(() async {
      if (await directory.exists()) await directory.delete(recursive: true);
    });

    test('writes and restores projects and exact calculation inputs', () async {
      final repository = FileWorkspaceRepository(directory: directory);
      final state = _workspaceWithCalculation();
      await repository.write(state);

      final restored = await repository.read();
      expect(restored, isNotNull);
      expect(restored!.toJson(), state.toJson());
      expect(
        restored.activeProject!.calculations.single.result.netArea,
        '32.64',
      );
      expect(
        restored.activeProject!.calculations.single.result.workKopecks,
        '4569600',
      );
      expect(
        await directory
            .list()
            .where((entry) => entry.path.endsWith('.tmp'))
            .length,
        0,
      );
    });

    test('keeps the previous valid workspace as a backup', () async {
      final repository = FileWorkspaceRepository(directory: directory);
      final first = WorkspaceData.demo();
      await repository.write(first);
      final second = first.copyWith(assistantQuestion: 'Новая рабочая запись');
      await repository.write(second);

      final backups = await directory
          .list()
          .where((entry) => entry is File && entry.path.endsWith('.backup'))
          .toList();
      expect(backups, hasLength(1));
      final prior = WorkspaceData.fromJson(
        jsonDecode(await File(backups.single.path).readAsString())
            as Map<String, dynamic>,
      );
      expect(prior.toJson(), first.toJson());
      expect(
        (await repository.read())!.assistantQuestion,
        'Новая рабочая запись',
      );
    });

    test('a damaged file is not silently replaced with demo data', () async {
      final repository = FileWorkspaceRepository(directory: directory);
      await repository.write(WorkspaceData.demo());
      final file =
          (await directory.list().where((entry) => entry is File).toList())
                  .single
              as File;
      const damaged = '{"format":"svoi-lyudi-native","projects":';
      await file.writeAsString(damaged);

      final store = WorkspaceStore(repository);
      addTearDown(store.dispose);
      await store.initialize();
      expect(store.ready, isTrue);
      expect(store.error, isNotNull);
      expect(await store.saveNow(), isFalse);
      expect(await file.readAsString(), damaged);
    });
  });

  group('Workspace ownership and persistence', () {
    test(
      'each object retains its own draft across selection and reload',
      () async {
        final initial = WorkspaceData(
          activeProjectId: 'one',
          projects: [
            ProjectModel(id: 'one', name: 'Первый объект'),
            ProjectModel(id: 'two', name: 'Второй объект'),
          ],
        );
        final repository = MemoryWorkspaceRepository(initial);
        final store = WorkspaceStore(repository, initialData: initial);
        addTearDown(store.dispose);
        final draft = CalculationDraft.empty().copyWith(
          walls: const [WallInput(width: '9', height: '3')],
        );
        store.updateDraft(draft);
        expect(await store.selectProject('two'), isTrue);
        expect(store.activeProject!.draft.walls.single.width, isEmpty);
        expect(await store.selectProject('one'), isTrue);
        expect(store.activeProject!.draft.walls.single.width, '9');

        final reloaded = WorkspaceStore(repository);
        addTearDown(reloaded.dispose);
        await reloaded.initialize();
        expect(reloaded.activeProject!.id, 'one');
        expect(reloaded.activeProject!.draft.walls.single.width, '9');
        expect(
          reloaded.data.projects
              .singleWhere((p) => p.id == 'two')
              .draft
              .walls
              .single
              .width,
          isEmpty,
        );
      },
    );

    test(
      'failed write does not acknowledge or retain a saved calculation',
      () async {
        final initial = WorkspaceData.demo();
        final repository = MemoryWorkspaceRepository(initial)
          ..failWrites = true;
        final store = WorkspaceStore(repository, initialData: initial);
        addTearDown(store.dispose);
        final draft = CalculationDraft.example();

        final accepted = await store.saveCalculation(
          draft,
          calculateSiding(draft),
        );
        expect(accepted, isFalse);
        expect(store.activeProject!.calculations, isEmpty);
        expect(repository.data!.activeProject!.calculations, isEmpty);
        expect(store.hasUnsavedChanges, isTrue);
        expect(store.error, isNotNull);
      },
    );

    test(
      'successful saved versions are immutable after later draft changes',
      () async {
        final repository = MemoryWorkspaceRepository();
        final store = WorkspaceStore(
          repository,
          initialData: WorkspaceData.demo(),
        );
        addTearDown(store.dispose);
        final original = CalculationDraft.example();
        expect(
          await store.saveCalculation(original, calculateSiding(original)),
          isTrue,
        );
        final savedId = store.activeProject!.calculations.single.id;
        store.updateDraft(
          original.copyWith(
            walls: const [WallInput(width: '10', height: '3')],
          ),
        );
        expect(await store.saveNow(), isTrue);
        final restored = await repository.read();
        final snapshot = restored!.activeProject!.calculations.single;
        expect(snapshot.id, savedId);
        expect(snapshot.draft.walls.first.width, '6');
        expect(snapshot.result.netArea, '32.64');
        expect(restored.activeProject!.draft.walls.single.width, '10');
      },
    );

    test('an invalid calculation is never inserted into an object', () async {
      final repository = MemoryWorkspaceRepository();
      final store = WorkspaceStore(
        repository,
        initialData: WorkspaceData.demo(),
      );
      addTearDown(store.dispose);
      final draft = CalculationDraft.empty();
      expect(
        await store.saveCalculation(draft, calculateSiding(draft)),
        isFalse,
      );
      expect(store.activeProject!.calculations, isEmpty);
      expect(repository.data, isNull);
    });

    test(
      'invalid imports preserve current objects and persisted data',
      () async {
        final initial = _workspaceWithCalculation();
        final repository = MemoryWorkspaceRepository(initial);
        final store = WorkspaceStore(repository, initialData: initial);
        addTearDown(store.dispose);
        final original = store.exportJson();

        await expectLater(store.importCopies('{broken'), throwsFormatException);
        await expectLater(
          store.importCopies(
            jsonEncode({
              'format': 'some-other-app',
              'version': 1,
              'projects': [],
            }),
          ),
          throwsFormatException,
        );
        expect(store.exportJson(), original);
        expect(repository.data!.toJson(), initial.toJson());
      },
    );

    test('imports create new project and calculation IDs without replacing originals', () async {
      final initial = _workspaceWithCalculation();
      final repository = MemoryWorkspaceRepository(initial);
      final store = WorkspaceStore(repository, initialData: initial);
      addTearDown(store.dispose);
      final originalProject = initial.projects.single;
      final imported = await store.importCopies(store.exportJson());

      expect(imported, 1);
      expect(store.data.projects, hasLength(2));
      expect(store.data.projects.first.toJson(), originalProject.toJson());
      final copy = store.data.projects.last;
      expect(copy.id, isNot(originalProject.id));
      expect(copy.name, contains('копия'));
      expect(
        copy.calculations.single.id,
        isNot(originalProject.calculations.single.id),
      );
      expect(
        copy.calculations.single.result.netArea,
        originalProject.calculations.single.result.netArea,
      );
      expect(repository.data!.projects, hasLength(2));
    });

    test(
      'failed import save leaves both memory and disk with original objects',
      () async {
        final initial = _workspaceWithCalculation();
        final repository = MemoryWorkspaceRepository(initial)
          ..failWrites = true;
        final store = WorkspaceStore(repository, initialData: initial);
        addTearDown(store.dispose);
        final text = store.exportJson();
        await expectLater(
          store.importCopies(text),
          throwsA(isA<FileSystemException>()),
        );
        expect(store.data.toJson(), initial.toJson());
        expect(repository.data!.toJson(), initial.toJson());
      },
    );

    test(
      'untrusted imported totals are recalculated from the saved inputs',
      () {
        final data = _workspaceWithCalculation().toJson();
        final projects = data['projects'] as List;
        final calculation =
            ((projects.single as Map)['calculations'] as List).single
                as Map<String, dynamic>;
        final result = calculation['result'] as Map<String, dynamic>;
        result['knownKopecks'] = '1';
        result['netArea'] = '999999';
        final restored = WorkspaceData.fromJson(data);
        expect(
          restored.activeProject!.calculations.single.result.netArea,
          '32.64',
        );
        expect(
          restored.activeProject!.calculations.single.result.knownKopecks,
          isNot('1'),
        );
      },
    );
  });
}

WorkspaceData _workspaceWithCalculation() {
  final draft = CalculationDraft.example().copyWith(
    panelPrice: '500',
    workPrice: '1000',
  );
  final calculation = SavedCalculation(
    id: 'saved-reference',
    createdAt: DateTime.utc(2026, 10, 26),
    draft: draft,
    result: calculateSiding(draft),
  );
  return WorkspaceData(
    activeProjectId: 'one',
    projects: [
      ProjectModel(
        id: 'one',
        name: 'Контрольный объект',
        draft: draft,
        updatedAt: DateTime.utc(2026, 10, 26),
        calculations: [calculation],
      ),
    ],
  );
}
