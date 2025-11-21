const FakeGen = {
  // --- Helpers ---
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],

  // --- API-based Word Generator ---
  randomWords: async (count = 2) => {
    try {
      const response = await fetch(`https://random-word-api.vercel.app/api?words=${count}`);
      if (!response.ok) throw new Error('API request failed');
      const words = await response.json();
      return words.join(' ');
    } catch (error) {
      console.warn("Smart Filler: Could not fetch random words, falling back to basic strings.", error);
      // Fallback to old method if API fails
      let result = '';
      for (let i = 0; i < count; i++) {
        result += Math.random().toString(36).substring(2, 8) + ' ';
      }
      return result.trim();
    }
  },
  
  // --- Generators ---
  randomString: (length = 8) => Math.random().toString(36).substring(2, 2 + length),

  randomName: () => {
    const names = ["Rizky", "Budi", "Dewi", "Sari", "Andi", "Yanto", "Agus", "Wati"];
    return FakeGen.pick(names);
  },

  randomEmail: () => FakeGen.randomName().toLowerCase() + Date.now().toString().slice(-4) + "@test.com",

  randomNumber: (min = 1000, max = 9999) => Math.floor(Math.random() * (max - min + 1)) + min,

  randomPhoneNumber: () => {
    const prefixes = ["0812", "0813", "0856", "0857", "0878", "0896"];
    const number = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
    return FakeGen.pick(prefixes) + number;
  },

  randomNIK: () => {
    let nik = String(FakeGen.randomNumber(11, 99)); // province
    nik += String(FakeGen.randomNumber(11, 79)); // city
    nik += String(FakeGen.randomNumber(11, 79)); // district
    nik += String(FakeGen.randomNumber(41, 71)); // birth date
    nik += String(FakeGen.randomNumber(1, 12)).padStart(2, '0'); // month
    nik += String(FakeGen.randomNumber(80, 99)); // year
    nik += String(FakeGen.randomNumber(1000, 9999)); // serial
    return nik;
  },
  
  randomAddress: async () => {
    const street = await FakeGen.randomWords(2);
    const city = await FakeGen.randomWords(1);
    return `Jl. ${street} No. ${FakeGen.randomNumber(1, 100)}, ${city}`;
  },
};
