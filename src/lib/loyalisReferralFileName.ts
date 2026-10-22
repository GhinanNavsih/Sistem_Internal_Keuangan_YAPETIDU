import type { ReferralLetter } from '@/lib/loyalis-referral-contract';

// Named after the code PMB's admin types, e.g. SR-Loyalis-9EF2.pdf; letters issued before codes keep their ID.
export const referralLetterFileName = (letter: Pick<ReferralLetter, 'id' | 'code'>) => letter.code ? `SR-Loyalis-${letter.code}.pdf` : `${letter.id}.pdf`;
