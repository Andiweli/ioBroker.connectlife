# ioBroker.connectlife 0.1.0

Experimenteller, inoffizieller ioBroker-Adapter für die ConnectLife-Cloud von unter anderem Hisense, Gorenje und ASKO.

## Funktionen

- ConnectLife-Login über Gigya und OAuth
- automatische Erkennung der im Konto vorhandenen Geräte
- regelmäßiger Abruf von `statusList`
- automatische Anlage von Rohdatenpunkten
- Klimaanlagen-Steuerung für Ein/Aus, Solltemperatur, Betriebsart, Lüfterstufe, Silent, Turbo, Eco sowie horizontale und vertikale Luftführung
- optionales Schreiben unbekannter Roh-Properties
- Verbindungs- und Fehlerstatus unter `info`

## Installation über ioBroker

Im ioBroker-Admin den Expertenmodus aktivieren und **Adapter aus eigener URL installieren** wählen.

GitHub-Adresse:

```text
https://github.com/Andiweli/ioBroker.connectlife
```

Alternativ per Konsole:

```bash
iobroker url https://github.com/Andiweli/ioBroker.connectlife

iobroker add connectlife
```

Danach die Instanz öffnen und die ConnectLife-E-Mail-Adresse sowie das Passwort eintragen.

## Muss der Adapter kompiliert werden?

Nein. Der Adapter besteht aus normalem JavaScript und läuft direkt unter Node.js. ioBroker installiert beim Einspielen automatisch die benötigten npm-Abhängigkeiten. Ein TypeScript-Compiler oder Build-Schritt ist nicht erforderlich.

## Erwartete Objektstruktur

```text
connectlife.0
├── info
│   ├── connection
│   ├── lastUpdate
│   └── lastError
└── devices
    └── DEVICE
        ├── info
        ├── status
        ├── controls
        └── raw
```

## Test und Log

```bash
iobroker logs connectlife.0 --watch
```

## Wichtiger Hinweis

Die verwendete ConnectLife-Schnittstelle ist nicht offiziell dokumentiert. Sie wurde aus der ConnectLife-App rekonstruiert. Endpunkte, Schlüssel, Eigenschaften oder der Login können sich jederzeit ändern.

## Noch nicht enthalten

- Energieverbrauch
- Push-Updates über WebSocket oder MQTT
- gerätespezifische Bedienoberflächen für Waschmaschinen, Trockner, Geschirrspüler oder Kühlschränke
- automatische Erkennung, welche gemeldeten Roh-Properties tatsächlich schreibbar sind
- Veröffentlichung im offiziellen ioBroker-Adapter-Repository
