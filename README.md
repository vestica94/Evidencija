# Evidencija
Evidencija viđanja djeteta i bilježenje događaja

Mobilna web-aplikacija (PWA) na hrvatskom jeziku za vođenje kronologije događaja
i dokaza (snimke zaslona poruka, fotografije, PDF-ovi) u obiteljskim predmetima –
uredno, s brojevima dokaza i naljepnicama, spremno za odvjetnika ili sud.

## Mogućnosti

- **Vremenska crta** – događaji poredani po datumu, s naslovom, opisom, oznakama
  i priloženim dokazima. Datum može biti i približan (samo godina/mjesec) ili
  trajati više dana. Pretraživanje i filtriranje po oznakama.
- **Događaj s dokumentom** – napravite snimku zaslona poruke, dodajte je u
  aplikaciju, upišite što se dogodilo i odaberite oznaku.
- **Oznake** (prilagodljive): Omalovažavanje / sukob, Problemi pri primopredaji,
  Zabrinutost – dijete, Zabrinutost – roditelj, Mentalno zdravlje, Značajni
  događaji, Uključenost roditelja, Pravo prvenstva čuvanja, Uzdržavanje,
  Zdravlje i škola, te vlastite oznake.
- **Dokazi** – svaki dokument automatski dobiva broj (P-01, P-02…) i žutu
  naljepnicu „Prilog predlagatelja" koja se utiskuje na sliku ili prvu stranicu
  PDF-a. Dokazi su grupirani po oznakama.
- **Izvoz** – popis dokaza za ispis/PDF ili CSV (Excel), preuzimanje dokaza s
  naljepnicama, ispis naljepnica za papirnate dokaze, ispis kronologije.
- **Viđanja djeteta** – brzi zapis ishoda (održano, kašnjenje, dijete nije
  predano, roditelj nije došao, otkazano) i statistika po mjesecima.
- **Privatnost** – nema servera ni registracije; svi podaci ostaju u pregledniku
  na uređaju (IndexedDB). Radi i bez interneta.
- **Sigurnosna kopija** – izvoz/uvoz svih podataka i dokumenata u jednu datoteku.

## Pokretanje

Aplikacija je statična (HTML/CSS/JS, bez izgradnje). Treba je posluživati preko
HTTP-a, npr.:

```sh
python3 -m http.server 8000
# otvorite http://localhost:8000
```

Za korištenje na mobitelu objavite mapu na bilo kojem statičnom hostingu s
HTTPS-om (npr. GitHub Pages: *Settings → Pages → Deploy from branch*), otvorite
adresu na mobitelu i odaberite **Dodaj na početni zaslon**. Na Androidu se tada
snimke zaslona mogu izravno *podijeliti* u Evidenciju.

## Važno

- Podaci postoje samo na uređaju na kojem su uneseni. Redovito izradite
  sigurnosnu kopiju (Postavke → Izvezi kopiju) i čuvajte je na sigurnom.
- Aplikacija nije pravni savjet. O načinu podnošenja dokaza posavjetujte se s
  odvjetnikom.

## Struktura

| Datoteka | Namjena |
|---|---|
| `index.html` | ljuska aplikacije |
| `css/app.css` | izgled (svijetla i tamna tema, ispis) |
| `js/app.js` | sučelje: vremenska crta, dokazi, viđanja, postavke, izvoz |
| `js/db.js` | pohrana u IndexedDB |
| `js/dates.js` | hrvatsko oblikovanje datuma |
| `js/stamp.js` | naljepnice dokaza na slikama i PDF-ovima |
| `sw.js`, `manifest.webmanifest` | rad bez interneta, instalacija, dijeljenje u aplikaciju |
| `vendor/pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT) |
