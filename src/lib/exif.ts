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
    let tags: any = {};
    let fallbackTimeMs: number | undefined = undefined;

    if (typeof fileOrUrl === 'string') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`/api/proxy-image?url=${encodeURIComponent(fileOrUrl)}`, { signal: controller.signal });
        if (!res.ok) {
          res = await fetch(fileOrUrl, { signal: controller.signal });
        }
      } catch (e) {
        res = await fetch(fileOrUrl, { signal: controller.signal });
      }
      clearTimeout(timeoutId);

      if (res.ok) {
        const lastModHeader = res.headers.get('last-modified');
        if (lastModHeader) {
          const parsedMs = Date.parse(lastModHeader);
          if (!isNaN(parsedMs)) fallbackTimeMs = parsedMs;
        }
        const buffer = await res.arrayBuffer();
        try {
          tags = ExifReader.load(buffer, { expanded: true });
          // Flatten tags if expanded object returned
          if (tags.exif || tags.gps || tags.xmp || tags.file || tags.png) {
            tags = {
              ...tags.exif,
              ...tags.gps,
              ...tags.xmp,
              ...tags.file,
              ...tags.png,
              ...tags.iptc,
            };
          }
        } catch (e) {
          tags = {};
        }
      }
    } else if (fileOrUrl instanceof File) {
      fallbackTimeMs = fileOrUrl.lastModified;
      try {
        tags = ExifReader.load(fileOrUrl, { expanded: true });
        if (tags.exif || tags.gps || tags.xmp || tags.file || tags.png) {
          tags = {
            ...tags.exif,
            ...tags.gps,
            ...tags.xmp,
            ...tags.file,
            ...tags.png,
            ...tags.iptc,
          };
        }
      } catch (e) {
        tags = {};
      }
    } else {
      try {
        tags = ExifReader.load(fileOrUrl);
      } catch (e) {
        tags = {};
      }
    }

    const rawDate =
      tags['DateTimeOriginal']?.description ||
      tags['DateTime']?.description ||
      tags['CreateDate']?.description ||
      tags['ModifyDate']?.description ||
      tags['DateCreated']?.description ||
      tags['DateTimeDigitized']?.description ||
      tags['xmp:CreateDate']?.description ||
      tags['xmp:ModifyDate']?.description ||
      tags['PNG:Creation Time']?.description ||
      tags['Creation Time']?.description ||
      tags['date:create']?.description ||
      tags['date:modify']?.description;

    let formattedDate: string | undefined = undefined;
    let isoDateString: string | undefined = undefined;

    if (rawDate) {
      const match = String(rawDate).match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[\sT]+(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hours, minutes, seconds] = match;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const mIdx = parseInt(month, 10) - 1;
        formattedDate = `${parseInt(day, 10)} ${monthNames[mIdx] || month} ${year}, ${hours}:${minutes}:${seconds}`;
        isoDateString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      } else {
        const d = new Date(String(rawDate));
        if (!isNaN(d.getTime())) {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
          formattedDate = `${parseInt(day, 10)} ${monthNames[d.getMonth()] || month} ${year}, ${hours}:${minutes}:${seconds}`;
          isoDateString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        } else {
          formattedDate = String(rawDate);
        }
      }
    } else if (fallbackTimeMs) {
      const d = new Date(fallbackTimeMs);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        formattedDate = `${parseInt(day, 10)} ${monthNames[d.getMonth()] || month} ${year}, ${hours}:${minutes}:${seconds} (Waktu Berkas)`;
        isoDateString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
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

    const make = tags['Make']?.description || tags['tiff:Make']?.description;
    const model = tags['Model']?.description || tags['tiff:Model']?.description;
    const software =
      tags['Software']?.description ||
      tags['ProcessingSoftware']?.description ||
      tags['HostComputer']?.description ||
      tags['CreatorTool']?.description;

    const hasExif = Boolean(
      rawDate ||
      (latitude !== undefined && longitude !== undefined) ||
      model ||
      make ||
      software ||
      formattedDate
    );

    return {
      url: typeof fileOrUrl === 'string' ? fileOrUrl : undefined,
      fileName: fileOrUrl instanceof File ? fileOrUrl.name : undefined,
      dateTimeOriginal: rawDate ? String(rawDate) : formattedDate,
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
