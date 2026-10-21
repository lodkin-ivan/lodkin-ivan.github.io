// Параметры эффекта «старая камера». Новые телефоны добавляются сюда.
const PRESETS = {
  c65: {
    name: 'Siemens C65',
    vga: [640, 480],
    qvga: [320, 240],
    previewScale: 0.5,      // превью рендерится в долю от разрешения снимка
    jpegQuality: 0.4,
    bitsR: 5, bitsG: 6, bitsB: 5, // RGB565
    contrast: 1.18,
    saturation: 1.25,
    tint: [-6, 4, 8],       // сдвиг R,G,B (холодный зеленовато-голубой)
    shadowTint: [-4, 6, 4],
    noise: 14,
    chromaNoise: 6,
    sharpen: 0.9,
    vignette: 0.35,
    bloom: 0.12,
    stampColor: '#ff9a1f',
  },
};
