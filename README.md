# ConnectLife Cloud für ioBroker

Experimenteller, inoffizieller ioBroker-Adapter für die ConnectLife-Cloud (getestet mit Hisense Klimageräten).

## Funktionen

- ConnectLife-Login über Gigya und OAuth
- automatische Erkennung der im Konto vorhandenen Geräte
- regelmäßiger Abruf von `statusList`
- automatische Anlage von Rohdatenpunkten
- Klimaanlagen-Steuerung für Ein/Aus, Solltemperatur, Betriebsart, Lüfterstufe, Silent, Turbo, Eco sowie horizontale und vertikale Luftführung
- optionales Schreiben unbekannter Roh-Properties
- Verbindungs- und Fehlerstatus unter `info`
- automatische einmalige Wiederholung bei einem ConnectLife-Fehler `randStr check fail`
- stabilere Verbindungsanzeige bei einzelnen vorübergehenden Cloud-Fehlern

## Installation über ioBroker

Im ioBroker-Admin den Expertenmodus aktivieren und **Adapter aus eigener URL installieren** wählen.

GitHub-Adresse:

```text
https://github.com/Andiweli/ioBroker.connectlife
```

Danach die Instanz öffnen und die ConnectLife-E-Mail-Adresse sowie das Passwort eintragen.

## Schreiben auf Rohdatenpunkte

Unter `devices.<Gerät>.raw` legt der Adapter die von ConnectLife gelieferten Original-Eigenschaften ab.

Ist **Schreiben auf unbekannte Rohdatenpunkte erlauben** aktiviert, können solche Original-Eigenschaften direkt an die ConnectLife-Cloud gesendet werden. Das ist hauptsächlich zum Testen noch nicht komfortabel abgebildeter Funktionen gedacht. Nicht jeder Rohdatenpunkt ist tatsächlich beschreibbar; ungültige Werte können von der Cloud oder vom Gerät abgelehnt werden.

Für den normalen Betrieb sollte diese Option ausgeschaltet bleiben.

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

## Wichtiger Hinweis

Die verwendete ConnectLife-Schnittstelle ist nicht offiziell dokumentiert. Sie wurde aus der ConnectLife-App rekonstruiert. Endpunkte, Schlüssel, Eigenschaften oder der Login können sich jederzeit ändern.

Dieser Adapter wurde KI-unterstützt entwickelt und ist erhältlich unter https://github.com/Andiweli/ioBroker.connectlife

Basiert auf Teilen von https://github.com/Bilan/connectlife-api-connector

## Noch nicht enthalten

- Energieverbrauch
- Push-Updates über WebSocket oder MQTT
- gerätespezifische Bedienoberflächen für Waschmaschinen, Trockner, Geschirrspüler oder Kühlschränke
- automatische Erkennung, welche gemeldeten Roh-Properties tatsächlich schreibbar sind
- Veröffentlichung im offiziellen ioBroker-Adapter-Repository
