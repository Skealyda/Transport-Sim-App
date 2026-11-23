import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Feature from 'ol/Feature.js';
import Collection from 'ol/Collection.js';
import * as Observable from 'ol/Observable.js';
import * as control from 'ol/control.js';
import * as extent from 'ol/extent.js';
import * as geom from 'ol/geom.js';
import * as interaction from 'ol/interaction.js';
import * as layer from 'ol/layer.js';
import * as proj from 'ol/proj.js';
import * as source from 'ol/source.js';
import * as sphere from 'ol/sphere.js';
import * as style from 'ol/style.js';
import * as tilegrid from 'ol/tilegrid.js';
import { createIcons, icons } from 'lucide';

globalThis.ol = {
	Map,
	View,
	Feature,
	Collection,
	Observable,
	control,
	extent,
	geom,
	interaction,
	layer,
	proj,
	source,
	sphere,
	style,
	tilegrid
};

globalThis.lucide = {
	createIcons: (options = {}) => createIcons({ ...options, icons })
};
