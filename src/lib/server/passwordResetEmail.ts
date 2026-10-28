export const PASSWORD_RESET_REPLY_TO = 'admin.bak@unipdu.ac.id';

type PasswordResetEmailInput = {
  email: string;
  link: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPasswordResetEmail({ email, link }: PasswordResetEmailInput) {
  const subject = 'Atur ulang kata sandi akun BAK UNIPDU Anda';

  const text = [
    'Halo,',
    '',
    `Kami menerima permintaan untuk mengatur ulang kata sandi akun ${email} di BAK UNIPDU.`,
    '',
    'Klik tautan berikut untuk membuat kata sandi baru:',
    link,
    '',
    'Tautan ini berlaku terbatas waktu. Jika Anda tidak meminta pengaturan ulang ini, abaikan email ini. Kata sandi Anda tidak akan berubah.',
    '',
    'Terima kasih,',
    'Tim BAK UNIPDU',
  ].join('\n');

  const safeEmail = escapeHtml(email);
  const safeLink = escapeHtml(link);

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f1f5f9; padding: 24px 12px;">
      <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
        <p style="margin: 0 0 4px; font-size: 13px; font-weight: bold; color: #4f46e5;">BAK UNIPDU</p>
        <h2 style="margin: 0 0 20px; font-size: 22px; color: #0f172a;">Atur ulang kata sandi</h2>
        <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6; color: #334155;">Halo,</p>
        <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #334155;">
          Kami menerima permintaan untuk mengatur ulang kata sandi akun <strong>${safeEmail}</strong>. Klik tombol di bawah untuk membuat kata sandi baru.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${safeLink}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 28px; border-radius: 12px; font-size: 15px; font-weight: bold; text-decoration: none;">Atur Ulang Kata Sandi</a>
        </div>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #64748b;">
          Jika tombol tidak berfungsi, salin tautan berikut ke browser Anda:<br>
          <a href="${safeLink}" style="color: #4f46e5; word-break: break-all;">${safeLink}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px;">
        <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
          Tautan ini berlaku terbatas waktu. Jika Anda tidak meminta pengaturan ulang ini, abaikan email ini. Kata sandi Anda tidak akan berubah.
        </p>
      </div>
    </div>
  `;

  return { subject, text, html };
}
