// Published dimensions seed idealised test contours, not project bills of materials.
// Heights, openings, blocks, joints, quantities and structural sizes below are
// explicit SYNTHETIC test inputs. They are not prescriptions or extracted plans.
export const HOUSE_FIXTURES = [
  { id: 'nalchik-6x6', title: 'Нальчик: условный прямоугольный участок стен',
    geometry: { wallHeightSum: '2.7', rectOpenings: '10', gableArea: '8', gableOpenings: '1', wallThicknessMm: '150', solidReplacements: '0' },
    expected: { footprint: 36, perimeter: 24, wallArea: 61.8, mainWallArea: 54.8, frameGableArea: 7, wallVolume: 7.977 } },
  { id: 'odk-6x8', title: 'ОДК 6×8: условный прямоугольный каркас',
    geometry: { wallHeightSum: '2.8', rectOpenings: '12', gableArea: '10', gableOpenings: '1', frameLumber: '3.25', insulationArea: '60', insulationThicknessMm: '150', floorArea: '46' },
    roof: { mode: 'duopitch', ridgeLength: '8', span: '6', angle: '30', eave: '0.5', endOverhang: '0.3', holes: '0' },
    foundation: { type: 'strip', length: '30', width: '0.4', heightMm: '600' },
    expected: { footprint: 48, perimeter: 28, wallArea: 75.4, frameLumber: 3.25, insulationVolume: 9, floorArea: 46, roofArea: 69.512972, foundationVolume: 7.2 } },
  { id: 're-103', title: 'RE-103: условный сплошной прямоугольник, не фактическая геометрия проекта',
    geometry: { wallHeightSum: '5.5', rectOpenings: '30', gableArea: '12', gableOpenings: '0', wallThicknessMm: '375', solidReplacements: '1.5', blockLengthMm: '600', blockHeightMm: '200', blockWidthMm: '375', verticalJointMm: '3', horizontalJointMm: '3' },
    expected: { footprint: 80, perimeter: 36, wallArea: 180, wallVolume: 62.90625, blockCount: 1371 } }
];
