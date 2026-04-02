/**
 * Resize an image file to max `maxDim` px on the longest side.
 * Returns a base64 JPEG string (without the data:... prefix).
 */
export async function resizeToBase64(file, maxDim = 1024) {
  // Handle HEIC by converting first
  let blob = file;
  if (file.type === 'image/heic' || file.name?.toLowerCase().endsWith('.heic')) {
    const heic2any = (await import('heic2any')).default;
    blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // Return as data URL then strip prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}
