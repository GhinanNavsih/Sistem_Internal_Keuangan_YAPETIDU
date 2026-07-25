import ExifReader from 'exifreader';

export interface ImageExifInsights {
  url?: string;
  fileName?: string;
  dateTimeOriginal?: string;
  formattedDate?: string;
  isoDateString?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  make?: string;
  model?: string;
  software?: string;
  hasExif: boolean;
}

export async function parseImageExif(fileOrUrl: File | ArrayBuffer | string): Promise<ImageExifInsights> {
  try {
    let tags: any;
    if (typeof fileOrUrl === 'string') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(fileOrUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return { hasExif: false };
      const buffer = await res.arrayBuffer();
      tags = ExifReader.load(buffer);
    } else if (fileOrUrl instanceof File) {
      tags = await ExifReader.load(fileOrUrl);
    } else {
      tags = ExifReader.load(fileOrUrl);
    }

    const rawDate = tags['DateTimeOriginal']?.description || tags['DateTime']?.description || tags['CreateDate']?.description;
    let formattedDate: string | undefined = undefined;
    let isoDateString: string | undefined = undefined;

    if (rawDate) {
      const match = String(rawDate).match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hours, minutes, seconds] = match;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const mIdx = parseInt(month, 10) - 1;
        formattedDate = `${parseInt(day, 10)} ${monthNames[mIdx] || month} ${year}, ${hours}:${minutes}:${seconds}`;
        isoDateString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      } else {
        formattedDate = String(rawDate);
      }
    }

    let latitude: number | undefined = undefined;
    let longitude: number | undefined = undefined;
    let googleMapsUrl: string | undefined = undefined;

    if (tags['GPSLatitude']?.description !== undefined && tags['GPSLongitude']?.description !== undefined) {
      latitude = Number(tags['GPSLatitude'].description);
      longitude = Number(tags['GPSLongitude'].description);

      const latRef = tags['GPSLatitudeRef']?.value?.[0] || tags['GPSLatitudeRef']?.description;
      const lngRef = tags['GPSLongitudeRef']?.value?.[0] || tags['GPSLongitudeRef']?.description;

      if (latRef && String(latRef).toUpperCase().startsWith('S') && latitude > 0) latitude = -latitude;
      if (lngRef && String(lngRef).toUpperCase().startsWith('W') && longitude > 0) longitude = -longitude;

      if (!isNaN(latitude) && !isNaN(longitude) && (latitude !== 0 || longitude !== 0)) {
        googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      } else {
        latitude = undefined;
        longitude = undefined;
      }
    }

    const make = tags['Make']?.description;
    const model = tags['Model']?.description;
    const software = tags['Software']?.description;

    const hasExif = Boolean(rawDate || (latitude !== undefined && longitude !== undefined) || model || make);

    return {
      url: typeof fileOrUrl === 'string' ? fileOrUrl : undefined,
      fileName: fileOrUrl instanceof File ? fileOrUrl.name : undefined,
      dateTimeOriginal: rawDate ? String(rawDate) : undefined,
      formattedDate,
      isoDateString,
      latitude,
      longitude,
      googleMapsUrl,
      make: make ? String(make) : undefined,
      model: model ? String(model) : undefined,
      software: software ? String(software) : undefined,
      hasExif,
    };
  } catch (err) {
    return { hasExif: false };
  }
}
