/*! elementor-pro - v3.12.2 - 09-04-2023 */
(self.webpackChunkelementor_pro = self.webpackChunkelementor_pro || []).push([
  [819],
  {
    2: (e, t, n) => {
      "use strict";
      var s = n(3203);
      n(4242);
      var i = s(n(4774)),
        o = s(n(9575)),
        r = s(n(6254)),
        a = s(n(5161)),
        l = s(n(5039)),
        c = s(n(9210)),
        d = s(n(450)),
        u = s(n(7660));

      // Define ElementorProFrontendConfig as an empty object if not defined
      var ElementorProFrontendConfig = ElementorProFrontendConfig || { urls: { assets: '' } };

      class ElementorProFrontend extends elementorModules.ViewModule {
        onInit() {
          super.onInit();
          this.config = ElementorProFrontendConfig;
          this.modules = {};
          this.initOnReadyComponents();
        }

        bindEvents() {
          jQuery(window).on(
            "elementor/frontend/init",
            this.onElementorFrontendInit.bind(this)
          );
        }

        initModules() {
          let e = {
            motionFX: i.default,
            sticky: o.default,
            codeHighlight: r.default,
            videoPlaylist: a.default,
            payments: l.default,
            progressTracker: c.default,
          };
          elementorProFrontend.trigger("elementor-pro/modules/init:before");
          elementorProFrontend.trigger("elementor-pro/modules/init/before");
          e = elementorFrontend.hooks.applyFilters(
            "elementor-pro/frontend/handlers",
            e
          );
          jQuery.each(e, ((e, t) => {
            this.modules[e] = new t();
          }));
          this.modules.linkActions = {
            addAction: function () {
              elementorFrontend.utils.urlActions.addAction(...arguments);
            },
          };
        }

        onElementorFrontendInit() {
          this.initModules();
        }

        initOnReadyComponents() {
          this.utils = {
            controls: new d.default(),
            DropdownMenuHeightController: u.default,
          };
        }
      }

      window.elementorProFrontend = new ElementorProFrontend();
    },

    450: (e, t) => {
      "use strict";
      Object.defineProperty(t, "__esModule", { value: !0 });
      t.default = void 0;
      t.default = class Controls {
        getControlValue(e, t, n) {
          let s;
          return (s =
            "object" == typeof e[t] && n ? e[t][n] : e[t]),
            s;
        }

        getResponsiveControlValue(e, t) {
          let n = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : "";
          const s = elementorFrontend.getCurrentDeviceMode(),
            i = this.getControlValue(e, t, n);
          if ("widescreen" === s) {
            const s = this.getControlValue(e, `${t}_widescreen`, n);
            return s || 0 === s ? s : i;
          }
          const o = elementorFrontend.breakpoints.getActiveBreakpointsList({
            withDesktop: !0,
          });
          let r = s,
            a = o.indexOf(s),
            l = "";
          for (; a <= o.length;) {
            if ("desktop" === r) {
              l = i;
              break;
            }
            const s = `${t}_${r}`,
              c = this.getControlValue(e, s, n);
            if (c || 0 === c) {
              l = c;
              break;
            }
            a++, (r = o[a]);
          }
          return l;
        }
      };
    },

    // ... More code here ...

    // Modified line: Commented out direct usage of ElementorProFrontendConfig
    // n.p = ElementorProFrontendConfig.urls.assets + "js/";
  },
]);