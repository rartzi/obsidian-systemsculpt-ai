import { Setting, TextComponent, ToggleComponent } from "obsidian";
import { BrainModule } from "../BrainModule";
import { AIService } from "../../../api/AIService";
import { OpenAIProvider } from "../../../api/providers/OpenAIProvider";
import { GroqAIProvider } from "../../../api/providers/GroqAIProvider";
import { OpenRouterAIProvider } from "../../../api/providers/OpenRouterAIProvider";
import { LocalAIProvider } from "../../../api/providers/LocalAIProvider";
import { AnthropicAIProvider } from "../../../api/providers/AnthropicAIProvider";
import { AIProviderKey, providerKeyMap } from "../../../api/types";

type ValidateFunction = (value: string, baseUrl?: string) => Promise<boolean>;

interface APIProvider {
  name: string;
  settingKey: keyof BrainModule["settings"];
  showSettingKey: keyof BrainModule["settings"];
  validateFunction: ValidateFunction;
  placeholder?: string;
}

export class EndpointManager {
  private plugin: BrainModule;
  private containerEl: HTMLElement;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(containerEl: HTMLElement, plugin: BrainModule) {
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  renderEndpointSettings(): void {
    this.renderAPIEndpointToggles();
    this.renderAPISettings();
  }

  private renderAPIEndpointToggles(): void {
    const apiEndpointsContainer = this.containerEl.createDiv(
      "systemsculpt-api-endpoints-container"
    );
    apiEndpointsContainer.createEl("h3", { text: "API Endpoints" });

    const apiEndpointsList = apiEndpointsContainer.createDiv(
      "systemsculpt-api-endpoints-list"
    );
    const apiEndpointsGroup = apiEndpointsList.createDiv(
      "systemsculpt-api-endpoints-group"
    );

    const apiEndpoints = [
      { id: "openAI", name: "OpenAI" },
      { id: "groq", name: "Groq" },
      { id: "openRouter", name: "OpenRouter" },
      { id: "anthropic", name: "Anthropic" },
      { id: "localEndpoint", name: "Local" },
    ];

    apiEndpoints.forEach((endpoint) => {
      const apiEndpointItem = apiEndpointsGroup.createDiv(
        "systemsculpt-modal-item"
      );
      const apiEndpointName = apiEndpointItem.createDiv(
        "systemsculpt-modal-name"
      );
      apiEndpointName.setText(endpoint.name);

      const toggleComponent = new ToggleComponent(apiEndpointItem);
      const settingKey =
        `show${endpoint.id}Setting` as keyof typeof this.plugin.settings;
      const isEnabled = this.plugin.settings[settingKey] as boolean;
      toggleComponent.setValue(isEnabled);
      toggleComponent.onChange(async (value) => {
        (this.plugin.settings[settingKey] as boolean) = value;
        await this.plugin.saveSettings();
        apiEndpointItem.toggleClass("systemsculpt-disabled", !value);

        this.renderAPISettings();
      });
    });
  }

  private renderAPISettings(): void {
    const apiProviders: APIProvider[] = [
      {
        name: "OpenAI",
        settingKey: "openAIApiKey",
        showSettingKey: "showopenAISetting",
        validateFunction: (value: string) =>
          OpenAIProvider.validateApiKey(value, "https://api.openai.com/v1"),
      },
      {
        name: "Groq",
        settingKey: "groqAPIKey",
        showSettingKey: "showgroqSetting",
        validateFunction: (value: string) =>
          GroqAIProvider.validateApiKey(value),
      },
      {
        name: "OpenRouter",
        settingKey: "openRouterAPIKey",
        showSettingKey: "showopenRouterSetting",
        validateFunction: (value: string) =>
          OpenRouterAIProvider.validateApiKey(value),
      },
      {
        name: "Anthropic",
        settingKey: "anthropicApiKey",
        showSettingKey: "showAnthropicSetting",
        validateFunction: (value: string) =>
          AnthropicAIProvider.validateApiKey(value),
      },
      {
        name: "Local",
        settingKey: "localEndpoint",
        showSettingKey: "showlocalEndpointSetting",
        validateFunction: (value: string) =>
          LocalAIProvider.validateApiKey("", value),
        placeholder: "http://localhost:1234",
      },
    ];

    apiProviders.forEach((provider) => {
      if (
        this.plugin.settings[
          provider.showSettingKey as keyof typeof this.plugin.settings
        ]
      ) {
        this.renderAPISetting(provider);
      }
    });
  }

  private renderAPISetting(provider: {
    name: string;
    settingKey: keyof BrainModule["settings"];
    validateFunction: (
      value: string,
      baseOpenAIApiUrl?: string
    ) => Promise<boolean>;
    placeholder?: string;
  }): void {
    let apiSettingTextComponent: TextComponent;

    const setting = new Setting(this.containerEl)
      .setName(
        `${provider.name} ${provider.name === "Local" ? "Endpoint" : provider.name === "OpenAI Base URL" ? "" : "API Key"}`
      )
      .setDesc(
        `Enter your ${provider.name} ${
          provider.name === "Local"
            ? "endpoint URL"
            : provider.name === "OpenAI Base URL"
              ? "base URL"
              : "API key"
        }`
      )
      .addText((text) => {
        apiSettingTextComponent = text;
        text
          .setPlaceholder(provider.placeholder || "API Key")
          .setValue(this.plugin.settings[provider.settingKey] as string)
          .onChange(async (value) => {
            this.plugin.settings[provider.settingKey] = value as never;
            await this.plugin.saveSettings();
            this.debouncedReinitialize(
              value,
              apiSettingTextComponent,
              provider.settingKey
            );
          });

        if (provider.name !== "Local" && provider.name !== "OpenAI Base URL") {
          text.inputEl.type = "password";
          text.inputEl.addEventListener("focus", () => {
            text.inputEl.type = "text";
          });
          text.inputEl.addEventListener("blur", () => {
            text.inputEl.type = "password";
          });
        }

        // Set initial value to placeholder if empty for OpenAI Base URL
        if (
          provider.name === "OpenAI Base URL" &&
          (this.plugin.settings[provider.settingKey] as string).trim() === ""
        ) {
          (this.plugin.settings[provider.settingKey] as string) =
            provider.placeholder || "";
          text.setValue(provider.placeholder || "");
        }

        this.validateSettingAndUpdateStatus(
          this.plugin.settings[provider.settingKey] as string,
          apiSettingTextComponent,
          provider
        );
      })
      .addExtraButton((button) => {
        button.setIcon("reset");
        button.onClick(async () => {
          await this.validateSettingAndUpdateStatus(
            this.plugin.settings[provider.settingKey] as string,
            apiSettingTextComponent,
            provider
          );
          await this.plugin.refreshAIService();
        });
        button.setTooltip(
          `Re-check ${
            provider.name === "Local"
              ? "Endpoint"
              : provider.name === "OpenAI Base URL"
                ? "Base URL"
                : "API Key"
          } and Refresh AI Service`
        );
      });
  }

  private renderSimpleAPISetting(provider: {
    name: string;
    settingKey: keyof BrainModule["settings"];
    placeholder?: string;
  }): void {
    new Setting(this.containerEl)
      .setName(provider.name)
      .setDesc(`Enter your ${provider.name}`)
      .addText((text) => {
        text
          .setPlaceholder(provider.placeholder || "URL")
          .setValue(this.plugin.settings[provider.settingKey] as string)
          .onChange((value: string) => {
            this.saveImmediately(value, provider.settingKey);
          });
      });
  }

  private saveImmediately(
    value: string,
    settingKey: keyof BrainModule["settings"]
  ): void {
    (this.plugin.settings[settingKey] as string) = value;
    this.plugin.saveSettings();
  }

  private debouncedReinitialize(
    value: string,
    textComponent: TextComponent,
    settingKey: keyof BrainModule["settings"]
  ): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      try {
        const provider = this.getProviderFromSettingKey(settingKey);
        if (provider) {
          await this.validateSettingAndUpdateStatus(value, textComponent, {
            name: provider,
            settingKey,
            validateFunction: this.getValidationFunction(provider),
          });
          await this.plugin.AIService.updateSettings({
            [settingKey]: value,
          });
        }
      } catch (error) {
        this.updateStatus(textComponent, "Error refreshing", false);
      }
    }, 3000);
  }

  private getValidationFunction(
    provider: AIProviderKey
  ): (apiKey: string, endpoint?: string) => Promise<boolean> {
    const validationFunctions: Record<
      AIProviderKey,
      (apiKey: string, endpoint?: string) => Promise<boolean>
    > = {
      openai: (apiKey: string) =>
        OpenAIProvider.validateApiKey(apiKey, "https://api.openai.com/v1"),
      groq: (apiKey: string) => GroqAIProvider.validateApiKey(apiKey),
      openRouter: (apiKey: string) =>
        OpenRouterAIProvider.validateApiKey(apiKey),
      anthropic: (apiKey: string) => AnthropicAIProvider.validateApiKey(apiKey),
      local: (apiKey: string, endpoint?: string) =>
        LocalAIProvider.validateApiKey(
          apiKey,
          endpoint || "http://localhost:1234"
        ),
      all: async () => true, // No validation needed for 'all'
    };

    return validationFunctions[provider];
  }

  private getProviderFromSettingKey(
    settingKey: keyof BrainModule["settings"]
  ): AIProviderKey {
    return providerKeyMap[settingKey] || "all";
  }

  private getProviderKeyFromName(name: string): AIProviderKey {
    const nameToKey: Record<string, AIProviderKey> = {
      OpenAI: "openai",
      Groq: "groq",
      OpenRouter: "openRouter",
      Local: "local",
      Anthropic: "anthropic",
    };
    return nameToKey[name] || "all";
  }

  private async validateSettingAndUpdateStatus(
    value: string,
    textComponent: TextComponent,
    provider: {
      name: string;
      settingKey: keyof BrainModule["settings"];
      validateFunction: ValidateFunction;
    }
  ): Promise<void> {
    const statusTextEl =
      textComponent.inputEl.nextElementSibling ||
      this.createSpan("systemsculpt-api-key-status");
    if (!textComponent.inputEl.nextElementSibling) {
      textComponent.inputEl.insertAdjacentElement("afterend", statusTextEl);
    }

    statusTextEl.textContent = "Validating...";
    statusTextEl.className =
      "systemsculpt-api-key-status systemsculpt-validating";

    let isValid = false;

    try {
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("Validation timeout")), 3000)
      );
      const validationPromise = (async () => {
        switch (provider.name) {
          case "OpenAI":
            return await provider.validateFunction(value);
          case "Groq":
            return await provider.validateFunction(value);
          case "OpenRouter":
            return await provider.validateFunction(value);
          case "Anthropic":
            return await provider.validateFunction(value);
          case "Local":
            return await provider.validateFunction(value);
          default:
            return false;
        }
      })();

      isValid = await Promise.race([validationPromise, timeoutPromise]);

      if (isValid) {
        statusTextEl.textContent = "Online";
        statusTextEl.classList.remove(
          "systemsculpt-validating",
          "systemsculpt-invalid"
        );
        statusTextEl.classList.add("systemsculpt-valid");

        await this.plugin.reinitializeProvider(
          this.getProviderKeyFromName(provider.name)
        );
      } else {
        statusTextEl.textContent = "Offline";
        statusTextEl.classList.remove(
          "systemsculpt-validating",
          "systemsculpt-valid"
        );
        statusTextEl.classList.add("systemsculpt-invalid");
      }
    } catch (error) {
      statusTextEl.textContent =
        error instanceof Error && error.message === "Validation timeout"
          ? "Timeout"
          : "Error";
      statusTextEl.classList.remove(
        "systemsculpt-validating",
        "systemsculpt-valid"
      );
      statusTextEl.classList.add("systemsculpt-invalid");
    }
  }

  private updateStatus(
    textComponent: TextComponent,
    message: string,
    isValid: boolean
  ): void {
    const statusTextEl = textComponent.inputEl
      .nextElementSibling as HTMLElement;
    if (statusTextEl) {
      statusTextEl.textContent = message;
      statusTextEl.className = `systemsculpt-api-key-status ${
        isValid ? "systemsculpt-valid" : "systemsculpt-invalid"
      }`;
    }
  }

  private createSpan(className: string): HTMLElement {
    const span = document.createElement("span");
    span.className = className;
    return span;
  }
}
