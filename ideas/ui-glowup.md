## UI Glowup

### Główny problem
- Aplikacja posiada zestaw funkcjonalności który miała zaplanowany. Uytkownik moze dodac auto, dodawac wpisy i je przegladac ale aplikacja wyglada jakby byla szybko skleconym projektem w ktorym nic nie ma sensu. Brakuje spojnosci nawigacji, uzytkownik musi sie domyslac lub zgadywac url gdzie nalezy przejsc aby skorzystać z danej funkcji

### Najmniejszy zestaw funkcjonalności
- Ustrukturyzowana nawigacja w aplikacji która pozwoli uzytkownikowi na swobodne poruszanie sie po aplikacji

### Co NIE wchodzi w zakres MVP
- Gruntowne zmiany dzialania podstawowych funkcjonalnosci aplikacji

### Kryteria sukcesu
- Ustrukturyzowana nawigacja pozwalająca dostać się w miejsca aplikacji bez zgadywania URL
- Usunięcie wizualnego boilerplate

#### Obserwacje
Te elementy UI/UX zostały znalezione podczas manualnych testów aplikacji:
- Wchodząć bezpośrednio na link: "http://localhost:4321/" uzytkownik odrazu trafia na strone 10x astro startera nie zaleznie od stanu zalogowania. Tego ekranu nie powinno w ogole byc bo jest on czescia boilerplate.
    - Wchodzac na strone, w zaleznosci od stanu zalogowania, uzytkownik powinien zobaczyc dashboard "http://localhost:4321/dashboard" lub ekran logowania "http://localhost:4321/auth/signin"
- Pasek nawigacyjny jest bardzo maly i za bardzo uproszczony. User po nawigacji do Entries czy AI Chat nie ma zadnego znacznika gdzie obecnie sie znajduje. Same linki w gornym pasku sa dosyc male i malo widoczne
- Dashboard jest lysy. Ma bardzo duzo wolnego miejsca ktorego nie wykorzystuje. Moze pokazmy ostatni entry pod kafelkami oil change inspection i insurance?
- /Entries jest raczej spojnym ekranem ale brakuje mozliwosci otworzenia detali danego entry. Obecnie wszystkie entry sa w prostej liscie "History" i jesli ktos stosuje bogate opisy "rich text" to splaszczamy jego formatowanie do jednej linii co powoduje ze wpisy sa bardzo slabo czytelne
    - Uzytkownik chcialby moc kliknac w kafelek netry w history i zobaczyc go na pelnym ekranie tak aby kazdy jego element byl czytelny
- Uproszczenie Repairs, Oil Changes, Inspections, Insurance jest zbyt daleko idące. O ile Repairs i oil changes mozna sie klocic ze sa bardzo podobne do siebie o tyle Inspections i Insurance nie sa zakladkami z ktorych korzysta sie czesto (raczej raz na rok). Uzytkownicy widizeli by bardziej dedykowana zakladke pod obie z tych opcji
- AI Chat jest malo uzyteczny. Obecny darmowy model jest oczywiscie problemem slabych odpowiedzi ale czat wydaje sie nie korzystac z historii napraw. Wyslanie zapytania do czatu jest malo czytelne dla uzytkownika, przycisk Ask zostaje w stanie "sending..." jakby cos sie zepsulo zamiast zablokowac interfejs i wyswietlic jakis loader odpowiedzi z czatu. Czat nie posiada roznych konwersacji ani historii co rowniez jest uciazliwe bo po przeladowaniu strony tracimy jakakolwiek konwersacje