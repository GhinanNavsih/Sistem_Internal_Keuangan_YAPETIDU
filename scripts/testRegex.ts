const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)$/i;

const testWords = ['Makmun', 'Setyobudi', 'Ummah', 'Arifin', 'Farid'];

testWords.forEach(w => {
  const match = w.match(DEGREE_PATTERN);
  console.log(`Word: "${w}" | Match:`, match ? match[0] : 'NONE');
});
